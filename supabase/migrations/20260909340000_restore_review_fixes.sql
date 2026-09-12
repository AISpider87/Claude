-- Findings of the security review of the restore points and of the pending
-- free operations (2026-09-12). Everything below was reproduced against a
-- local database before the fix.
--
-- H1  undoing a free release whose slot had already paid for a purchase turned
--     a counted swap into a free one: the 20-swap limit could be bypassed.
-- M1  a point taken while operations were pending gave the season swaps back
--     for operations the restore kept.
-- M2  a team created after the point lost its roster and ledger but kept the
--     credits it had spent.
-- M3  restoring a point taken during an open session failed on the
--     single-open-session index.
-- M4  the restore door (superlega.restore) was left open for the rest of the
--     transaction, and it trusted the flag alone.
-- M5  the removed operations were not kept anywhere.
-- M6  a release still pending made the player buyable by everybody.
-- L1/L2/L6/L7 RLS on the new table, a cheaper listing, session windows
--     restored too, and a version on the payload.

-- ---------------------------------------------------------------------------
-- M6: a pending release does not free the player yet
-- ---------------------------------------------------------------------------
-- The free-agent list stays the live one on purpose (admin decision: a free
-- slot is filled from who is free *now*), but "free" cannot include a player
-- whose release is still waiting for the closing and can be undone.
create or replace view public.free_agents
with (security_invoker = false)
as
  select p.*
  from public.players p
  where p.status = 'active'
    and private.is_league_member()
    and not exists (
      select 1 from public.roster_players r
      where r.player_id = p.id and r.released_at is null
    )
    and not exists (
      select 1 from public.transactions t
      where t.player_out_id = p.id and t.status = 'pending'
    );

-- ---------------------------------------------------------------------------
-- H1: the free slot must still be free to undo the release that opened it
-- ---------------------------------------------------------------------------
create or replace function public.undo_pending_operation(p_tx_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_team public.teams%rowtype;
  v_role text;
  v_via text;
begin
  select * into v_tx from public.transactions where id = p_tx_id;
  if not found then
    raise exception 'TX_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not private.can_manage_team(v_tx.team_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_tx.status <> 'pending' then
    raise exception 'NOT_PENDING' using errcode = '55000';
  end if;
  if (public.current_market_session()).id is null then
    raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
  end if;
  perform private.check_market_throttle(v_tx.team_id);
  select * into v_team from public.teams where id = v_tx.team_id for update;

  if v_tx.kind = 'buy' then
    delete from public.roster_players
    where team_id = v_tx.team_id and player_id = v_tx.player_in_id and released_at is null and acquired_via = 'buy';
    if not found then
      raise exception 'IN_PLAYER_NO_LONGER_IN_ROSTER' using errcode = '55000';
    end if;
  elsif v_tx.kind in ('sell', 'free_release') then
    v_via := case when v_tx.kind = 'sell' then 'sell' else 'free_release' end;
    if exists (select 1 from public.roster_players where team_id = v_tx.team_id and player_id = v_tx.player_out_id and released_at is null) then
      raise exception 'OUT_PLAYER_ALREADY_IN_ROSTER' using errcode = '55000';
    end if;
    -- the seat must still be free: otherwise a bought replacement would leave
    -- the roster one player over the composition (security review H1)
    select role_classic into v_role from public.players where id = v_tx.player_out_id;
    if private.role_slots(v_tx.team_id, v_role) <= 0 then
      raise exception 'NO_ROLE_SLOT' using errcode = '22023', detail = v_role;
    end if;
    -- …and for a free release, the FREE slot it opened must still be unused.
    -- Otherwise: release out-of-list, sell a good player, buy his replacement
    -- for free on that slot, then undo the release — a swap that never counted.
    if v_tx.kind = 'free_release' and private.free_slots(v_tx.team_id, v_role) <= 0 then
      raise exception 'FREE_SLOT_ALREADY_USED' using errcode = '22023', detail = v_role;
    end if;
    update public.roster_players set released_at = null, released_via = null
    where id = (select id from public.roster_players
                where team_id = v_tx.team_id and player_id = v_tx.player_out_id and released_via = v_via
                order by released_at desc limit 1);
    if not found then
      raise exception 'NOT_IN_ROSTER' using errcode = 'P0002';
    end if;
  else
    raise exception 'NOT_PENDING' using errcode = '55000';
  end if;

  if v_team.credits - v_tx.credits_delta < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;
  update public.teams set credits = credits - v_tx.credits_delta where id = v_tx.team_id;

  delete from public.transactions where id = p_tx_id;
  perform private.audit('market.undo', 'transactions', p_tx_id::text,
    jsonb_build_object('team_id', v_tx.team_id, 'kind', v_tx.kind,
                       'player', coalesce(v_tx.player_in_id, v_tx.player_out_id), 'credits_delta', v_tx.credits_delta));
end;
$$;
revoke all on function public.undo_pending_operation(uuid) from public, anon;
grant execute on function public.undo_pending_operation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- M4 + L1: the door closes behind the restore, and it is not the flag alone
-- ---------------------------------------------------------------------------
alter table private.restore_points enable row level security;

create or replace function private.transactions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- The one door: a running restore, which only public.admin_restore opens,
  -- for its own transaction, and only while an admin is behind the request.
  if coalesce(current_setting('superlega.restore', true), '') = 'on' and private.is_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'pending' then
      return old;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status = 'pending' and new.status = 'confirmed'
       and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
      return new;
    end if;
  end if;
  raise exception 'IMMUTABLE_ROW' using errcode = '55000';
end;
$$;

-- ---------------------------------------------------------------------------
-- M1 + L7: the payload keeps the status of every operation, and a version
-- ---------------------------------------------------------------------------
/** The operations a point photographed, with the status they had. Reads both
    payload shapes: v1 stored bare ids, v2 stores {id, status}. */
create or replace function private.restore_tx(p_payload jsonb)
returns table (id uuid, status text)
language sql immutable
as $$
  select case when jsonb_typeof(e) = 'object' then e ->> 'id' else e #>> '{}' end::uuid,
         case when jsonb_typeof(e) = 'object' then e ->> 'status' end
  from jsonb_array_elements(coalesce(p_payload -> 'tx_ids', '[]'::jsonb)) e;
$$;
revoke all on function private.restore_tx(jsonb) from public;

create or replace function private.capture_restore_point(p_label text, p_auto boolean default false)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into private.restore_points (label, created_by, auto, payload)
  values (
    left(trim(p_label), 80), auth.uid(), p_auto,
    jsonb_build_object(
      'version', 2,
      'teams', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', t.id, 'credits', t.credits, 'swaps_used', t.swaps_used)), '[]'::jsonb)
                from public.teams t),
      'roster', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.roster_players r),
      -- ids AND status: a point taken while something was pending must put
      -- that status back, or the restore would hand the swaps back for
      -- operations it keeps (security review M1)
      'tx_ids', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status)), '[]'::jsonb)
                 from public.transactions t),
      'sessions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', s.id, 'status', s.status, 'opens_at', s.opens_at, 'closes_at', s.closes_at,
                     'opened_at', s.opened_at, 'closed_at', s.closed_at,
                     'extra_budget_applied', s.extra_budget_applied, 'validation_report', s.validation_report)), '[]'::jsonb)
                   from public.market_sessions s)))
  returning id into v_id;

  -- keep the list short: the payload of each point is the whole league
  delete from private.restore_points
  where id in (select id from private.restore_points
               order by taken_at desc offset private.restore_points_kept());
  return v_id;
end;
$$;
revoke all on function private.capture_restore_point(text, boolean) from public;

-- ---------------------------------------------------------------------------
-- L2: the listing counts the later operations with an array, not a subquery
-- ---------------------------------------------------------------------------
create or replace function public.admin_restore_points()
returns table (
  id uuid, label text, taken_at timestamptz, auto boolean,
  teams integer, roster integer, operations_after integer
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  return query
    select p.id, p.label, p.taken_at, p.auto,
           jsonb_array_length(p.payload -> 'teams'),
           (select count(*)::integer from jsonb_array_elements(p.payload -> 'roster') e
            where e ->> 'released_at' is null),
           (select count(*)::integer from public.transactions t
            where not (t.id = any (k.ids)))
    from private.restore_points p
    cross join lateral (
      select coalesce(array_agg(x.id), '{}'::uuid[]) as ids from private.restore_tx(p.payload) x
    ) k
    order by p.taken_at desc;
end;
$$;
revoke all on function public.admin_restore_points() from public, anon;
grant execute on function public.admin_restore_points() to authenticated;

-- ---------------------------------------------------------------------------
-- the restore itself: M1, M2, M3, M4, M5, L6, L7
-- ---------------------------------------------------------------------------
create or replace function public.admin_restore(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_point private.restore_points%rowtype;
  v_payload jsonb;
  v_removed jsonb;
  v_tx_deleted integer;
  v_tx_status integer;
  v_sessions_reset integer;
  v_roster integer;
  v_teams integer;
begin
  perform private.require_admin();
  select * into v_point from private.restore_points where id = p_id for update;
  if not found then
    raise exception 'RESTORE_POINT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_payload := v_point.payload;
  -- a payload written by a newer version of the app is not ours to interpret
  if coalesce((v_payload ->> 'version')::integer, 1) > 2 then
    raise exception 'RESTORE_VERSION' using errcode = '55000';
  end if;

  -- every team is locked first: no market operation may slip in half-way
  perform 1 from public.teams for update;

  -- Defence in depth: neither a team nor a listone player can be deleted while
  -- anything references it, so this should be unreachable — but if a point ever
  -- outlives one of them, say it plainly instead of failing on a foreign key.
  if exists (select 1 from jsonb_array_elements(v_payload -> 'roster') e
             where not exists (select 1 from public.teams t where t.id = (e ->> 'team_id')::uuid)) then
    raise exception 'RESTORE_TEAM_MISSING' using errcode = '55000';
  end if;
  if exists (select 1 from jsonb_array_elements(v_payload -> 'roster') e
             where not exists (select 1 from public.players pl where pl.id = (e ->> 'player_id')::integer)) then
    raise exception 'RESTORE_PLAYER_MISSING' using errcode = '55000';
  end if;
  -- A team born after the point would be emptied of roster and ledger while
  -- keeping the credits it spent (security review M2): refuse instead.
  if exists (select 1 from public.teams t
             where not exists (select 1 from jsonb_array_elements(v_payload -> 'teams') e
                               where (e ->> 'id')::uuid = t.id)) then
    raise exception 'RESTORE_TEAM_NEW' using errcode = '55000';
  end if;

  perform set_config('superlega.restore', 'on', true);

  -- 1. the ledger: the operations that came after the point never happened.
  --    They are kept in the audit entry, so nothing is lost silently (M5).
  select jsonb_agg(to_jsonb(t)) into v_removed
  from public.transactions t
  where not (t.id = any (select x.id from private.restore_tx(v_payload) x));

  delete from public.transactions t
  where not (t.id = any (select x.id from private.restore_tx(v_payload) x));
  get diagnostics v_tx_deleted = row_count;

  -- …and the ones it keeps go back to the status they had (M1)
  update public.transactions t
  set status = x.status
  from private.restore_tx(v_payload) x
  where t.id = x.id and x.status is not null and t.status <> x.status;
  get diagnostics v_tx_status = row_count;

  -- 2. rosters, exactly as they were (released rows included)
  delete from public.roster_players where true;
  insert into public.roster_players
  select * from jsonb_populate_recordset(null::public.roster_players, v_payload -> 'roster');
  select count(*)::integer into v_roster from public.roster_players where released_at is null;

  -- 3. credits and season swaps
  update public.teams t
  set credits = s.credits, swaps_used = s.swaps_used, updated_at = now()
  from jsonb_to_recordset(v_payload -> 'teams') as s(id uuid, credits integer, swaps_used integer)
  where t.id = s.id;
  select count(*)::integer into v_teams
  from jsonb_array_elements(v_payload -> 'teams') e
  join public.teams t on t.id = (e ->> 'id')::uuid;

  -- 4. sessions go back to the status they had at the point, so an open one
  --    can be opened again (extra budget included) and a closed one loses a
  --    report that no longer matches anything.
  --    Every open session is demoted first: the index that allows a single open
  --    session is checked row by row (security review M3).
  update public.market_sessions set status = 'scheduled' where status = 'open';

  update public.market_sessions s
  set status = e.status, opened_at = e.opened_at, closed_at = e.closed_at,
      opens_at = coalesce(e.opens_at, s.opens_at), closes_at = coalesce(e.closes_at, s.closes_at),
      extra_budget_applied = e.extra_budget_applied, validation_report = e.validation_report,
      updated_at = now()
  from jsonb_to_recordset(v_payload -> 'sessions')
    as e(id uuid, status text, opens_at timestamptz, closes_at timestamptz,
         opened_at timestamptz, closed_at timestamptz,
         extra_budget_applied boolean, validation_report jsonb)
  where s.id = e.id;

  -- A session created after the point is NOT deleted: the admin planned it, and
  -- the point of going back is being able to run it again. It simply becomes
  -- "not run yet" (dates untouched: the admin moves them if they are past).
  update public.market_sessions s
  set status = 'scheduled', opened_at = null, closed_at = null,
      extra_budget_applied = false, validation_report = null, updated_at = now()
  where not exists (select 1 from jsonb_array_elements(v_payload -> 'sessions') e
                    where (e ->> 'id')::uuid = s.id);
  get diagnostics v_sessions_reset = row_count;

  -- a session that is scheduled again has no free-agent snapshot yet
  delete from public.session_free_agents f
  using public.market_sessions s
  where s.id = f.session_id and s.status = 'scheduled';

  -- the door closes behind us, inside the same transaction (M4)
  perform set_config('superlega.restore', 'off', true);

  perform private.audit('restore.apply', 'restore_points', p_id::text,
    jsonb_build_object('label', v_point.label, 'taken_at', v_point.taken_at,
                       'transactions_deleted', v_tx_deleted, 'transactions_reopened', v_tx_status,
                       'sessions_reset', v_sessions_reset, 'roster', v_roster, 'teams', v_teams,
                       'removed', coalesce(v_removed, '[]'::jsonb)));
  return jsonb_build_object('label', v_point.label, 'taken_at', v_point.taken_at,
    'transactions_deleted', v_tx_deleted, 'transactions_reopened', v_tx_status,
    'sessions_reset', v_sessions_reset, 'roster', v_roster, 'teams', v_teams);
end;
$$;
revoke all on function public.admin_restore(uuid) from public, anon;
grant execute on function public.admin_restore(uuid) to authenticated;
