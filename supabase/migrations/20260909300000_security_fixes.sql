-- Findings of the security review of the availability feed and of market v2.1.
-- H1 undoing a release could push a roster over the composition;
-- M4 claim_availability_refresh was callable by any authenticated user;
-- M6 a manual status could carry a javascript: source URL, rendered as a link
--    in every manager's roster (the feed path already required http(s));
-- L7 undo/confirm had no database-side throttle;
-- L13 undo/confirm were possible after the session window had closed.

-- M6: the database is the last word on the scheme of a source link.
create or replace function private.set_player_status(
  p_player_id integer, p_kind text, p_note text, p_source_name text, p_source_url text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_url text := nullif(trim(p_source_url), '');
begin
  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_kind = 'ok' then
    delete from public.player_status where player_id = p_player_id;
    return;
  end if;
  if p_kind not in ('injured', 'doubtful', 'suspended', 'unavailable') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  if v_url is not null and v_url !~* '^https?://' then
    raise exception 'INVALID_SOURCE_URL' using errcode = '22023';
  end if;
  insert into public.player_status (player_id, kind, note, source_name, source_url, origin, updated_by, updated_at)
  values (p_player_id, p_kind, left(nullif(trim(p_note), ''), 200), left(nullif(trim(p_source_name), ''), 60),
          v_url, 'manual', auth.uid(), now())
  on conflict (player_id) do update
    set kind = excluded.kind, note = excluded.note, source_name = excluded.source_name,
        source_url = excluded.source_url, origin = 'manual',
        updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function private.set_player_status(integer, text, text, text, text) from public;

-- M4: only the service role runs the staleness claim; the app already calls it
-- with the service client.
revoke execute on function public.claim_availability_refresh(integer) from authenticated;

-- H1 + L7 + L13: undoing a release may not break the composition, both undo and
-- confirm are throttled like the other market operations, and neither works once
-- the session window is over (the autopilot confirms what is left at closing).
create or replace function public.undo_pending_operation(p_tx_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_team public.teams%rowtype;
  v_role text;
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
  elsif v_tx.kind = 'sell' then
    if exists (select 1 from public.roster_players where team_id = v_tx.team_id and player_id = v_tx.player_out_id and released_at is null) then
      raise exception 'OUT_PLAYER_ALREADY_IN_ROSTER' using errcode = '55000';
    end if;
    -- the seat must still be free: otherwise a bought replacement would leave
    -- the roster one player over the composition (security review H1)
    select role_classic into v_role from public.players where id = v_tx.player_out_id;
    if private.role_slots(v_tx.team_id, v_role) <= 0 then
      raise exception 'NO_ROLE_SLOT' using errcode = '22023', detail = v_role;
    end if;
    update public.roster_players set released_at = null, released_via = null
    where id = (select id from public.roster_players
                where team_id = v_tx.team_id and player_id = v_tx.player_out_id and released_via = 'sell'
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

create or replace function public.confirm_pending_operations(p_team_id uuid)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  if not private.can_manage_team(p_team_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if (public.current_market_session()).id is null then
    raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
  end if;
  perform private.check_market_throttle(p_team_id);
  v_rows := private.confirm_team_pending(p_team_id);
  if v_rows = 0 then
    raise exception 'NOTHING_PENDING' using errcode = 'P0002';
  end if;
  perform private.audit('market.confirm', 'teams', p_team_id::text, jsonb_build_object('operations', v_rows));
  return v_rows;
end;
$$;
revoke all on function public.confirm_pending_operations(uuid) from public, anon;
grant execute on function public.confirm_pending_operations(uuid) to authenticated;
