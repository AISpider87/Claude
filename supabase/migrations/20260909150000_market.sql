-- M4: market sessions, swaps, free swaps, reversals, close validation.
-- Rules: docs/SPEC.md §3, .claude/skills/market-rules/SKILL.md

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

-- The caller may act for a team if they own it or are an admin.
create or replace function private.can_manage_team(p_team_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select private.is_admin() or exists (
    select 1 from public.teams t
    join public.profiles p on p.user_id = t.owner_id
    where t.id = p_team_id and t.owner_id = auth.uid() and p.is_active
  );
$$;
revoke all on function private.can_manage_team(uuid) from public;

-- The session in which swaps are allowed right now, if any.
create or replace function public.current_market_session()
returns public.market_sessions
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select s from public.market_sessions s
  where s.status = 'open' and now() < s.closes_at
  limit 1;
$$;
grant execute on function public.current_market_session() to authenticated;

create or replace function private.price_for(p_rule text, p_qt_a integer, p_paid integer)
returns integer
language sql immutable
as $$
  select case when p_rule = 'price_paid' then p_paid else p_qt_a end;
$$;
revoke all on function private.price_for(text, integer, integer) from public;

-- ---------------------------------------------------------------------------
-- sessions (admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_session(
  p_name text, p_opens_at timestamptz, p_closes_at timestamptz, p_extra_budget integer default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform private.require_admin();
  if p_closes_at <= p_opens_at then
    raise exception 'INVALID_WINDOW' using errcode = '22023';
  end if;
  insert into public.market_sessions (name, opens_at, closes_at, extra_budget, created_by)
  values (trim(p_name), p_opens_at, p_closes_at,
          coalesce(p_extra_budget, private.setting_int('session_extra_budget', 5)), auth.uid())
  returning id into v_id;
  perform private.audit('session.create', 'market_sessions', v_id::text,
    jsonb_build_object('name', p_name, 'opens_at', p_opens_at, 'closes_at', p_closes_at));
  return v_id;
end;
$$;
revoke all on function public.admin_create_session(text, timestamptz, timestamptz, integer) from public;
grant execute on function public.admin_create_session(text, timestamptz, timestamptz, integer) to authenticated;

create or replace function public.admin_update_session(
  p_id uuid, p_name text, p_opens_at timestamptz, p_closes_at timestamptz, p_extra_budget integer
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  perform private.require_admin();
  if p_closes_at <= p_opens_at then
    raise exception 'INVALID_WINDOW' using errcode = '22023';
  end if;
  select status into v_status from public.market_sessions where id = p_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status = 'closed' then
    raise exception 'SESSION_CLOSED' using errcode = '55000';
  end if;
  update public.market_sessions
  set name = trim(p_name), opens_at = p_opens_at, closes_at = p_closes_at,
      extra_budget = case when v_status = 'scheduled' then p_extra_budget else extra_budget end
  where id = p_id;
  perform private.audit('session.update', 'market_sessions', p_id::text,
    jsonb_build_object('name', p_name, 'opens_at', p_opens_at, 'closes_at', p_closes_at));
end;
$$;
revoke all on function public.admin_update_session(uuid, text, timestamptz, timestamptz, integer) from public;
grant execute on function public.admin_update_session(uuid, text, timestamptz, timestamptz, integer) to authenticated;

create or replace function public.admin_delete_session(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  delete from public.market_sessions where id = p_id and status = 'scheduled';
  if not found then
    raise exception 'SESSION_NOT_DELETABLE' using errcode = '55000';
  end if;
  perform private.audit('session.delete', 'market_sessions', p_id::text, null);
end;
$$;
revoke all on function public.admin_delete_session(uuid) from public;
grant execute on function public.admin_delete_session(uuid) to authenticated;

-- Opening: freeze the free-agent list and credit the extra budget exactly once.
create or replace function public.open_market_session(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.market_sessions%rowtype;
  v_free integer;
begin
  perform private.require_admin();
  select * into v_session from public.market_sessions where id = p_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'SESSION_NOT_SCHEDULED' using errcode = '55000';
  end if;
  if exists (select 1 from public.market_sessions where status = 'open') then
    raise exception 'ANOTHER_SESSION_OPEN' using errcode = '55000';
  end if;
  if v_session.closes_at <= now() then
    raise exception 'SESSION_ALREADY_EXPIRED' using errcode = '55000';
  end if;

  -- lock every team so the +5 and the snapshot happen against a quiet ledger
  perform 1 from public.teams for update;

  insert into public.session_free_agents (session_id, player_id)
  select p_id, id from public.free_agents
  on conflict do nothing;
  select count(*) into v_free from public.session_free_agents where session_id = p_id;

  if not v_session.extra_budget_applied and v_session.extra_budget > 0 then
    update public.teams set credits = credits + v_session.extra_budget;
    insert into public.transactions (team_id, session_id, kind, credits_delta, note, created_by)
    select id, p_id, 'admin_credits', v_session.extra_budget, 'Budget extra apertura sessione', auth.uid()
    from public.teams;
  end if;

  update public.market_sessions
  set status = 'open', opened_at = now(), extra_budget_applied = true,
      opens_at = least(opens_at, now())
  where id = p_id;

  perform private.audit('session.open', 'market_sessions', p_id::text,
    jsonb_build_object('free_agents', v_free, 'extra_budget', v_session.extra_budget));
end;
$$;
revoke all on function public.open_market_session(uuid) from public;
grant execute on function public.open_market_session(uuid) to authenticated;

-- Roster validation used by the closing report and the UI.
create or replace function public.validate_rosters()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_comp jsonb := coalesce(private.setting_json('roster_composition'), '{"P":3,"D":7,"C":7,"A":6}'::jsonb);
  v_target integer := (v_comp ->> 'P')::int + (v_comp ->> 'D')::int + (v_comp ->> 'C')::int + (v_comp ->> 'A')::int;
  v_report jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'team_id', t.id, 'team', t.name, 'credits', t.credits, 'swaps_used', t.swaps_used,
    'count', s.cnt, 'by_role', s.by_role, 'out_of_list', s.ool,
    'ok', s.cnt = v_target
          and (s.by_role ->> 'P')::int = (v_comp ->> 'P')::int
          and (s.by_role ->> 'D')::int = (v_comp ->> 'D')::int
          and (s.by_role ->> 'C')::int = (v_comp ->> 'C')::int
          and (s.by_role ->> 'A')::int = (v_comp ->> 'A')::int
          and s.ool = 0
  ) order by t.name), '[]'::jsonb)
  into v_report
  from public.teams t
  cross join lateral (
    select count(*) as cnt,
           count(*) filter (where p.status = 'out_of_list') as ool,
           jsonb_build_object(
             'P', count(*) filter (where p.role_classic = 'P'),
             'D', count(*) filter (where p.role_classic = 'D'),
             'C', count(*) filter (where p.role_classic = 'C'),
             'A', count(*) filter (where p.role_classic = 'A')) as by_role
    from public.roster_players r
    join public.players p on p.id = r.player_id
    where r.team_id = t.id and r.released_at is null
  ) s;
  return jsonb_build_object('composition', v_comp, 'teams', v_report,
    'invalid', (select count(*) from jsonb_array_elements(v_report) e where not (e ->> 'ok')::boolean));
end;
$$;
revoke all on function public.validate_rosters() from public;
grant execute on function public.validate_rosters() to authenticated;

create or replace function public.close_market_session(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_report jsonb;
begin
  perform private.require_admin();
  select status into v_status from public.market_sessions where id = p_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
  end if;
  v_report := public.validate_rosters();
  update public.market_sessions
  set status = 'closed', closed_at = now(),
      closes_at = greatest(least(closes_at, now()), opens_at + interval '1 second'),
      validation_report = v_report
  where id = p_id;
  perform private.audit('session.close', 'market_sessions', p_id::text,
    jsonb_build_object('invalid', v_report -> 'invalid'));
  return v_report;
end;
$$;
revoke all on function public.close_market_session(uuid) from public;
grant execute on function public.close_market_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- swap (out + in, same role) during an open session
-- ---------------------------------------------------------------------------
create or replace function public.swap_player(p_team_id uuid, p_player_out integer, p_player_in integer)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_team public.teams%rowtype;
  v_session public.market_sessions;
  v_out public.players%rowtype;
  v_in public.players%rowtype;
  v_paid integer;
  v_refund integer;
  v_cost integer;
  v_limit integer := private.setting_int('season_swap_limit', 20);
  v_rule text := coalesce(private.setting_json('sale_price_rule') #>> '{}', 'current_quotation');
  v_tx uuid;
begin
  if not private.can_manage_team(p_team_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_player_out = p_player_in then
    raise exception 'SAME_PLAYER' using errcode = '22023';
  end if;

  select * into v_team from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_session := public.current_market_session();
  if v_session.id is null then
    raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
  end if;

  select r.price_paid into v_paid
  from public.roster_players r
  where r.team_id = p_team_id and r.player_id = p_player_out and r.released_at is null;
  if not found then
    raise exception 'NOT_IN_ROSTER' using errcode = 'P0002';
  end if;
  select * into v_out from public.players where id = p_player_out;
  select * into v_in from public.players where id = p_player_in;
  if v_in.id is null or v_in.status <> 'active' then
    raise exception 'PLAYER_NOT_AVAILABLE' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.session_free_agents where session_id = v_session.id and player_id = p_player_in) then
    raise exception 'NOT_FREE_AGENT' using errcode = '22023';
  end if;
  if exists (select 1 from public.roster_players where team_id = p_team_id and player_id = p_player_in and released_at is null) then
    raise exception 'ALREADY_IN_ROSTER' using errcode = '23505';
  end if;
  if v_in.role_classic <> v_out.role_classic then
    raise exception 'ROLE_MISMATCH' using errcode = '22023';
  end if;
  if v_team.swaps_used >= v_limit then
    raise exception 'SWAP_LIMIT_REACHED' using errcode = '22023';
  end if;

  v_refund := private.price_for(v_rule, v_out.qt_a, v_paid);
  v_cost := v_in.qt_a;
  if v_team.credits + v_refund - v_cost < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;

  update public.roster_players set released_at = now(), released_via = 'swap'
  where team_id = p_team_id and player_id = p_player_out and released_at is null;
  insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
  values (p_team_id, p_player_in, v_cost, 'swap');
  update public.teams
  set credits = credits + v_refund - v_cost, swaps_used = swaps_used + 1
  where id = p_team_id;

  insert into public.transactions (team_id, session_id, kind, player_out_id, player_out_price,
    player_in_id, player_in_price, credits_delta, counts_toward_limit, created_by)
  values (p_team_id, v_session.id, 'swap', p_player_out, v_refund, p_player_in, v_cost,
    v_refund - v_cost, true, auth.uid())
  returning id into v_tx;
  perform private.audit('market.swap', 'transactions', v_tx::text,
    jsonb_build_object('team_id', p_team_id, 'out', p_player_out, 'in', p_player_in, 'refund', v_refund, 'cost', v_cost));
  return v_tx;
end;
$$;
revoke all on function public.swap_player(uuid, integer, integer) from public;
grant execute on function public.swap_player(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- free swap: replace a player who left Serie A, any time, not counted
-- ---------------------------------------------------------------------------
create or replace function public.free_swap_player(p_team_id uuid, p_player_out integer, p_player_in integer)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_team public.teams%rowtype;
  v_session public.market_sessions;
  v_out public.players%rowtype;
  v_in public.players%rowtype;
  v_paid integer;
  v_refund integer;
  v_cost integer;
  v_rule text := coalesce(private.setting_json('free_swap_refund_rule') #>> '{}', 'price_paid');
  v_tx uuid;
begin
  if not private.can_manage_team(p_team_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_team from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  select r.price_paid into v_paid
  from public.roster_players r
  where r.team_id = p_team_id and r.player_id = p_player_out and r.released_at is null;
  if not found then
    raise exception 'NOT_IN_ROSTER' using errcode = 'P0002';
  end if;
  select * into v_out from public.players where id = p_player_out;
  if v_out.status <> 'out_of_list' then
    raise exception 'NOT_OUT_OF_LIST' using errcode = '22023';
  end if;
  select * into v_in from public.players where id = p_player_in;
  if v_in.id is null or v_in.status <> 'active' then
    raise exception 'PLAYER_NOT_AVAILABLE' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.free_agents where id = p_player_in) then
    raise exception 'NOT_FREE_AGENT' using errcode = '22023';
  end if;
  if v_in.role_classic <> v_out.role_classic then
    raise exception 'ROLE_MISMATCH' using errcode = '22023';
  end if;

  v_refund := private.price_for(v_rule, v_out.qt_a, v_paid);
  v_cost := v_in.qt_a;
  if v_team.credits + v_refund - v_cost < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;

  v_session := public.current_market_session();

  update public.roster_players set released_at = now(), released_via = 'free_swap'
  where team_id = p_team_id and player_id = p_player_out and released_at is null;
  insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
  values (p_team_id, p_player_in, v_cost, 'free_swap');
  update public.teams set credits = credits + v_refund - v_cost where id = p_team_id;

  insert into public.transactions (team_id, session_id, kind, player_out_id, player_out_price,
    player_in_id, player_in_price, credits_delta, counts_toward_limit, created_by)
  values (p_team_id, v_session.id, 'free_swap', p_player_out, v_refund, p_player_in, v_cost,
    v_refund - v_cost, false, auth.uid())
  returning id into v_tx;
  perform private.audit('market.free_swap', 'transactions', v_tx::text,
    jsonb_build_object('team_id', p_team_id, 'out', p_player_out, 'in', p_player_in, 'refund', v_refund, 'cost', v_cost));
  return v_tx;
end;
$$;
revoke all on function public.free_swap_player(uuid, integer, integer) from public;
grant execute on function public.free_swap_player(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- reversal (admin): the inverse operation, never a delete
-- ---------------------------------------------------------------------------
create or replace function public.reverse_transaction(p_tx_id uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_team public.teams%rowtype;
  v_paid integer;
  v_rev uuid;
begin
  perform private.require_admin();
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v_tx from public.transactions where id = p_tx_id;
  if not found then
    raise exception 'TX_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_tx.kind = 'reversal' then
    raise exception 'CANNOT_REVERSE_REVERSAL' using errcode = '55000';
  end if;
  if exists (select 1 from public.transactions where reversal_of = p_tx_id) then
    raise exception 'ALREADY_REVERSED' using errcode = '55000';
  end if;
  select * into v_team from public.teams where id = v_tx.team_id for update;

  if v_team.credits - v_tx.credits_delta < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;

  -- undo the incoming player
  if v_tx.player_in_id is not null then
    update public.roster_players set released_at = now(), released_via = 'reversal'
    where team_id = v_tx.team_id and player_id = v_tx.player_in_id and released_at is null;
    if not found then
      raise exception 'IN_PLAYER_NO_LONGER_IN_ROSTER' using errcode = '55000';
    end if;
  end if;
  -- restore the outgoing player at the price they had before
  if v_tx.player_out_id is not null then
    if exists (select 1 from public.roster_players where team_id = v_tx.team_id and player_id = v_tx.player_out_id and released_at is null) then
      raise exception 'OUT_PLAYER_ALREADY_IN_ROSTER' using errcode = '55000';
    end if;
    select price_paid into v_paid from public.roster_players
    where team_id = v_tx.team_id and player_id = v_tx.player_out_id and released_at is not null
    order by released_at desc limit 1;
    insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
    values (v_tx.team_id, v_tx.player_out_id, coalesce(v_paid, v_tx.player_out_price, 0), 'reversal');
  end if;

  update public.teams
  set credits = credits - v_tx.credits_delta,
      swaps_used = case when v_tx.counts_toward_limit then greatest(swaps_used - 1, 0) else swaps_used end
  where id = v_tx.team_id;

  insert into public.transactions (team_id, session_id, kind, player_out_id, player_out_price,
    player_in_id, player_in_price, credits_delta, counts_toward_limit, note, reversal_of, created_by)
  values (v_tx.team_id, v_tx.session_id, 'reversal', v_tx.player_in_id, v_tx.player_in_price,
    v_tx.player_out_id, v_tx.player_out_price, -v_tx.credits_delta, false, trim(p_reason), p_tx_id, auth.uid())
  returning id into v_rev;
  perform private.audit('market.reverse', 'transactions', v_rev::text,
    jsonb_build_object('reversal_of', p_tx_id, 'reason', trim(p_reason)));
  return v_rev;
end;
$$;
revoke all on function public.reverse_transaction(uuid, text) from public;
grant execute on function public.reverse_transaction(uuid, text) to authenticated;
