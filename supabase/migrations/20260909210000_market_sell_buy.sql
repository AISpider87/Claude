-- Market v2 (admin decision 2026-09-10): operations are no longer atomic swaps.
-- A manager first RELEASES players (credits come back at the current Qt.A),
-- then BUYS free agents to fill the holes, role by role: a released defender
-- can only be replaced by a defender. Each purchase counts as one of the 20
-- season "cambi"; releases do not. Players who left Serie A are released for
-- free at any time (refund = price paid) and their replacement is bought at any
-- time without counting. The closing report still flags rosters with holes.
-- swap_player / free_swap_player stay valid (a swap is a release + a purchase).

alter table public.transactions drop constraint if exists transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
  check (kind in ('swap', 'free_swap', 'sell', 'buy', 'free_release', 'admin_assign', 'admin_remove', 'admin_credits', 'reversal'));
alter table public.roster_players drop constraint if exists roster_players_acquired_via_check;
alter table public.roster_players add constraint roster_players_acquired_via_check
  check (acquired_via in ('initial_import', 'admin', 'swap', 'free_swap', 'buy', 'reversal'));
alter table public.roster_players drop constraint if exists roster_players_released_via_check;
alter table public.roster_players add constraint roster_players_released_via_check
  check (released_via in ('swap', 'free_swap', 'sell', 'free_release', 'admin', 'reversal'));

-- ---------------------------------------------------------------------------
-- holes: how many players of a role the team is missing vs the composition
-- ---------------------------------------------------------------------------
create or replace function private.role_slots(p_team_id uuid, p_role text)
returns integer
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce((private.setting_json('roster_composition') ->> p_role)::integer,
                  case p_role when 'P' then 3 when 'D' then 7 when 'C' then 7 else 6 end)
       - (select count(*)::integer from public.roster_players r
          join public.players p on p.id = r.player_id
          where r.team_id = p_team_id and r.released_at is null and p.role_classic = p_role);
$$;
revoke all on function private.role_slots(uuid, text) from public;

-- Free slots of a role: free releases not yet compensated by a free purchase
-- (reversed operations do not count). Derived from the ledger: no extra state.
create or replace function private.free_slots(p_team_id uuid, p_role text)
returns integer
language sql stable
set search_path = public, pg_temp
as $$
  select (select count(*)::integer from public.transactions t
          join public.players p on p.id = t.player_out_id
          where t.team_id = p_team_id and t.kind = 'free_release' and p.role_classic = p_role
            and not exists (select 1 from public.transactions r where r.reversal_of = t.id))
       - (select count(*)::integer from public.transactions t
          join public.players p on p.id = t.player_in_id
          where t.team_id = p_team_id and t.kind = 'buy' and not t.counts_toward_limit and p.role_classic = p_role
            and not exists (select 1 from public.transactions r where r.reversal_of = t.id));
$$;
revoke all on function private.free_slots(uuid, text) from public;

-- Public, read-only view of a team's market state for the UI.
create or replace function public.team_market_state(p_team_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case when private.can_manage_team(p_team_id) or private.is_league_member() then
    jsonb_build_object(
      'slots', jsonb_build_object(
        'P', private.role_slots(p_team_id, 'P'), 'D', private.role_slots(p_team_id, 'D'),
        'C', private.role_slots(p_team_id, 'C'), 'A', private.role_slots(p_team_id, 'A')),
      'free_slots', jsonb_build_object(
        'P', private.free_slots(p_team_id, 'P'), 'D', private.free_slots(p_team_id, 'D'),
        'C', private.free_slots(p_team_id, 'C'), 'A', private.free_slots(p_team_id, 'A')))
  end;
$$;
revoke all on function public.team_market_state(uuid) from public, anon;
grant execute on function public.team_market_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- release (sell) during an open session: credits back at the current Qt.A
-- ---------------------------------------------------------------------------
create or replace function public.sell_player(p_team_id uuid, p_player_id integer)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_team public.teams%rowtype;
  v_session public.market_sessions;
  v_player public.players%rowtype;
  v_paid integer;
  v_refund integer;
  v_rule text := coalesce(private.setting_json('sale_price_rule') #>> '{}', 'current_quotation');
  v_tx uuid;
begin
  if not private.can_manage_team(p_team_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_team from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.check_market_throttle(p_team_id);

  select s.* into v_session from public.market_sessions s
  where s.status = 'open' and now() < s.closes_at
  limit 1 for share;
  if v_session.id is null then
    raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
  end if;

  select r.price_paid into v_paid
  from public.roster_players r
  where r.team_id = p_team_id and r.player_id = p_player_id and r.released_at is null;
  if not found then
    raise exception 'NOT_IN_ROSTER' using errcode = 'P0002';
  end if;
  select * into v_player from public.players where id = p_player_id;
  if v_player.status <> 'active' then
    raise exception 'USE_FREE_RELEASE' using errcode = '22023';
  end if;

  v_refund := private.price_for(v_rule, v_player.qt_a, v_paid);

  update public.roster_players set released_at = now(), released_via = 'sell'
  where team_id = p_team_id and player_id = p_player_id and released_at is null;
  update public.teams set credits = credits + v_refund where id = p_team_id;

  insert into public.transactions (team_id, session_id, kind, player_out_id, player_out_price,
    credits_delta, counts_toward_limit, created_by)
  values (p_team_id, v_session.id, 'sell', p_player_id, v_refund, v_refund, false, auth.uid())
  returning id into v_tx;
  perform private.audit('market.sell', 'transactions', v_tx::text,
    jsonb_build_object('team_id', p_team_id, 'out', p_player_id, 'refund', v_refund));
  return v_tx;
end;
$$;
revoke all on function public.sell_player(uuid, integer) from public, anon;
grant execute on function public.sell_player(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- free release of a player who left Serie A: any time, refund = price paid
-- ---------------------------------------------------------------------------
create or replace function public.release_out_of_list(p_team_id uuid, p_player_id integer)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_team public.teams%rowtype;
  v_session public.market_sessions;
  v_player public.players%rowtype;
  v_paid integer;
  v_refund integer;
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
  perform private.check_market_throttle(p_team_id);

  select r.price_paid into v_paid
  from public.roster_players r
  where r.team_id = p_team_id and r.player_id = p_player_id and r.released_at is null;
  if not found then
    raise exception 'NOT_IN_ROSTER' using errcode = 'P0002';
  end if;
  select * into v_player from public.players where id = p_player_id;
  if v_player.status <> 'out_of_list' then
    raise exception 'NOT_OUT_OF_LIST' using errcode = '22023';
  end if;

  v_refund := private.price_for(v_rule, v_player.qt_a, v_paid);
  v_session := public.current_market_session();

  update public.roster_players set released_at = now(), released_via = 'free_release'
  where team_id = p_team_id and player_id = p_player_id and released_at is null;
  update public.teams set credits = credits + v_refund where id = p_team_id;

  insert into public.transactions (team_id, session_id, kind, player_out_id, player_out_price,
    credits_delta, counts_toward_limit, created_by)
  values (p_team_id, v_session.id, 'free_release', p_player_id, v_refund, v_refund, false, auth.uid())
  returning id into v_tx;
  perform private.audit('market.free_release', 'transactions', v_tx::text,
    jsonb_build_object('team_id', p_team_id, 'out', p_player_id, 'refund', v_refund));
  return v_tx;
end;
$$;
revoke all on function public.release_out_of_list(uuid, integer) from public, anon;
grant execute on function public.release_out_of_list(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- purchase: fills a hole of the same role. A free slot (from a free release) is
-- filled first, at any time, from the current free agents, without counting;
-- otherwise the session must be open, the player must be in its snapshot and
-- the purchase counts toward the season limit.
-- ---------------------------------------------------------------------------
create or replace function public.buy_player(p_team_id uuid, p_player_id integer)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_team public.teams%rowtype;
  v_session public.market_sessions;
  v_player public.players%rowtype;
  v_cost integer;
  v_free boolean;
  v_limit integer := private.setting_int('season_swap_limit', 20);
  v_tx uuid;
begin
  if not private.can_manage_team(p_team_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_team from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.check_market_throttle(p_team_id);

  -- lock the player row: concurrent free purchases of the same player serialize
  select * into v_player from public.players where id = p_player_id for update;
  if v_player.id is null or v_player.status <> 'active' then
    raise exception 'PLAYER_NOT_AVAILABLE' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.roster_players where team_id = p_team_id and player_id = p_player_id and released_at is null) then
    raise exception 'ALREADY_IN_ROSTER' using errcode = '23505';
  end if;
  if private.role_slots(p_team_id, v_player.role_classic) <= 0 then
    raise exception 'NO_ROLE_SLOT' using errcode = '22023', detail = v_player.role_classic;
  end if;

  v_free := private.free_slots(p_team_id, v_player.role_classic) > 0;
  if v_free then
    if not exists (select 1 from public.free_agents where id = p_player_id) then
      raise exception 'NOT_FREE_AGENT' using errcode = '22023';
    end if;
    v_session := public.current_market_session();
  else
    select s.* into v_session from public.market_sessions s
    where s.status = 'open' and now() < s.closes_at
    limit 1 for share;
    if v_session.id is null then
      raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
    end if;
    if not exists (select 1 from public.session_free_agents where session_id = v_session.id and player_id = p_player_id) then
      raise exception 'NOT_FREE_AGENT' using errcode = '22023';
    end if;
    if v_team.swaps_used >= v_limit then
      raise exception 'SWAP_LIMIT_REACHED' using errcode = '22023';
    end if;
  end if;

  v_cost := v_player.qt_a;
  if v_team.credits - v_cost < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;

  insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
  values (p_team_id, p_player_id, v_cost, 'buy');
  update public.teams
  set credits = credits - v_cost,
      swaps_used = case when v_free then swaps_used else swaps_used + 1 end
  where id = p_team_id;

  insert into public.transactions (team_id, session_id, kind, player_in_id, player_in_price,
    credits_delta, counts_toward_limit, created_by)
  values (p_team_id, v_session.id, 'buy', p_player_id, v_cost, -v_cost, not v_free, auth.uid())
  returning id into v_tx;
  perform private.audit('market.buy', 'transactions', v_tx::text,
    jsonb_build_object('team_id', p_team_id, 'in', p_player_id, 'cost', v_cost, 'free', v_free));
  return v_tx;
end;
$$;
revoke all on function public.buy_player(uuid, integer) from public, anon;
grant execute on function public.buy_player(uuid, integer) to authenticated;
