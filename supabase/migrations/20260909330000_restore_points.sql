-- Admin request 2026-09-12: "vorrei un pulsante per riportare mercato, cambi e
-- crediti allo stato iniziale di quando ho caricato le rose".
--
-- Restore points: a labelled photograph of everything the market moves —
-- rosters, credits, season swaps, sessions — that the admin can go back to.
-- One is taken automatically right after a roster import ("Rose importate"),
-- which is exactly the state asked for; the admin can take more before a
-- trial session. Restoring is admin-only, audited, and destructive on purpose:
-- the operations that came after the point are removed, because they no longer
-- describe anything that happened.

-- ---------------------------------------------------------------------------
-- the ledger stays append-only, with one explicit door for the restore
-- ---------------------------------------------------------------------------
-- private.transactions_guard keeps rejecting every update and delete, except
-- for pending rows (undo / confirm) and while a restore is running: the
-- restore sets superlega.restore = 'on' for its own transaction only, and no
-- other function ever sets it. PostgREST cannot set it either (it only sets
-- role and request.* settings), so a manager has no way to open this door.
create or replace function private.transactions_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('superlega.restore', true), '') = 'on' then
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
-- storage: private schema, never exposed to the API
-- ---------------------------------------------------------------------------
create table if not exists private.restore_points (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 2 and 80),
  taken_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  auto boolean not null default false,
  payload jsonb not null
);
create index if not exists idx_restore_points_taken on private.restore_points (taken_at desc);

/** How many points are kept: the oldest ones are dropped by capture. */
create or replace function private.restore_points_kept()
returns integer
language sql stable
set search_path = public, pg_temp
as $$
  select greatest(private.setting_int('restore_points_kept', 12), 1);
$$;
revoke all on function private.restore_points_kept() from public;

-- ---------------------------------------------------------------------------
-- capture
-- ---------------------------------------------------------------------------
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
      'teams', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', t.id, 'credits', t.credits, 'swaps_used', t.swaps_used)), '[]'::jsonb)
                from public.teams t),
      'roster', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.roster_players r),
      -- the ids of the operations that existed: a restore removes the others.
      -- Ids, not a timestamp: inside one transaction now() never moves, so a
      -- point taken next to an operation could not tell them apart.
      'tx_ids', (select coalesce(jsonb_agg(t.id), '[]'::jsonb) from public.transactions t),
      'sessions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', s.id, 'status', s.status, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
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

-- p_auto only changes the label shown in the list ("automatico"): the roster
-- import takes its own point without the admin typing a name.
-- The single-argument version of this function never shipped, but drop it
-- anyway: two overloads would make the PostgREST call ambiguous.
drop function if exists public.admin_create_restore_point(text);
create or replace function public.admin_create_restore_point(p_label text, p_auto boolean default false)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform private.require_admin();
  if char_length(trim(coalesce(p_label, ''))) < 2 then
    raise exception 'INVALID_LABEL' using errcode = '22023';
  end if;
  v_id := private.capture_restore_point(p_label, coalesce(p_auto, false));
  perform private.audit('restore.capture', 'restore_points', v_id::text,
    jsonb_build_object('label', trim(p_label)));
  return v_id;
end;
$$;
revoke all on function public.admin_create_restore_point(text, boolean) from public, anon;
grant execute on function public.admin_create_restore_point(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- list (no payload: the UI only needs the label, the date and the size)
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
            where not exists (select 1 from jsonb_array_elements_text(p.payload -> 'tx_ids') x
                              where x.value::uuid = t.id))
    from private.restore_points p
    order by p.taken_at desc;
end;
$$;
revoke all on function public.admin_restore_points() from public, anon;
grant execute on function public.admin_restore_points() to authenticated;

create or replace function public.admin_delete_restore_point(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  delete from private.restore_points where id = p_id;
  if not found then
    raise exception 'RESTORE_POINT_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.audit('restore.delete', 'restore_points', p_id::text, null);
end;
$$;
revoke all on function public.admin_delete_restore_point(uuid) from public, anon;
grant execute on function public.admin_delete_restore_point(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- restore
-- ---------------------------------------------------------------------------
create or replace function public.admin_restore(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_point private.restore_points%rowtype;
  v_payload jsonb;
  v_tx_deleted integer;
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

  -- 1. the ledger: the operations that came after the point never happened
  perform set_config('superlega.restore', 'on', true);
  delete from public.transactions t
  where not exists (select 1 from jsonb_array_elements_text(v_payload -> 'tx_ids') x
                    where x.value::uuid = t.id);
  get diagnostics v_tx_deleted = row_count;

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
  --    report that no longer matches anything
  update public.market_sessions s
  set status = e.status, opened_at = e.opened_at, closed_at = e.closed_at,
      extra_budget_applied = e.extra_budget_applied, validation_report = e.validation_report,
      updated_at = now()
  from jsonb_to_recordset(v_payload -> 'sessions')
    as e(id uuid, status text, opened_at timestamptz, closed_at timestamptz,
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

  perform private.audit('restore.apply', 'restore_points', p_id::text,
    jsonb_build_object('label', v_point.label, 'taken_at', v_point.taken_at,
                       'transactions_deleted', v_tx_deleted, 'sessions_reset', v_sessions_reset,
                       'roster', v_roster, 'teams', v_teams));
  return jsonb_build_object('label', v_point.label, 'taken_at', v_point.taken_at,
    'transactions_deleted', v_tx_deleted, 'sessions_reset', v_sessions_reset,
    'roster', v_roster, 'teams', v_teams);
end;
$$;
revoke all on function public.admin_restore(uuid) from public, anon;
grant execute on function public.admin_restore(uuid) to authenticated;
