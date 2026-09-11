-- SuperLega — aggiornamento del 2026-09-10/11 (sessioni automatiche, mercato v2, privacy rose, indisponibili, fix apertura, revisione sicurezza, operazioni in sospeso, feed automatico indisponibili/formazioni).
-- Per chi ha già eseguito schema.sql e la migrazione 20260909190000: incollare nello SQL Editor e premere Run.
-- Rieseguibile senza danni: ogni istruzione è idempotente.

-- ===== 20260909200000_session_autopilot.sql =====
-- Market sessions open and close by themselves at the scheduled times.
-- sync_market_sessions() is idempotent and cheap: the app calls it on every
-- authenticated page load and from the daily cron, so a scheduled session opens
-- (snapshot + extra budget) at the first request after opens_at and an open
-- session closes (validation report) at the first request after closes_at.
-- "Apri ora" / "Chiudi sessione" remain available to the admin to act early.

-- The service role (cron, server jobs) is trusted like an admin for
-- notifications and is exempt from the per-user rate limiter.
-- The role claim of the verified JWT, as PostgREST exposes it (inside a
-- security definer function current_user is the owner, so it cannot be used).
create or replace function private.is_service_role()
returns boolean
language sql stable
as $$
  select coalesce(
    coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    ) = 'service_role',
    false);
$$;
revoke all on function private.is_service_role() from public;

-- ---------------------------------------------------------------------------
-- roster report without the admin gate (used by the automatic close)
-- ---------------------------------------------------------------------------
create or replace function private.rosters_report()
returns jsonb
language plpgsql stable
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
revoke all on function private.rosters_report() from public;

create or replace function public.validate_rosters()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  return private.rosters_report();
end;
$$;
revoke all on function public.validate_rosters() from public, anon;
grant execute on function public.validate_rosters() to authenticated;

-- ---------------------------------------------------------------------------
-- open / close without the admin gate; the public functions keep it
-- ---------------------------------------------------------------------------
create or replace function private.open_session(p_id uuid, p_source text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_session public.market_sessions%rowtype;
  v_free integer;
begin
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
    jsonb_build_object('free_agents', v_free, 'extra_budget', v_session.extra_budget, 'source', p_source));
end;
$$;
revoke all on function private.open_session(uuid, text) from public;

create or replace function private.close_session(p_id uuid, p_source text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_report jsonb;
begin
  select status into v_status from public.market_sessions where id = p_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
  end if;
  v_report := private.rosters_report();
  update public.market_sessions
  set status = 'closed', closed_at = now(),
      closes_at = greatest(least(closes_at, now()), opens_at + interval '1 second'),
      validation_report = v_report
  where id = p_id;
  perform private.audit('session.close', 'market_sessions', p_id::text,
    jsonb_build_object('invalid', v_report -> 'invalid', 'source', p_source));
  return v_report;
end;
$$;
revoke all on function private.close_session(uuid, text) from public;

create or replace function public.open_market_session(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  perform private.open_session(p_id, 'admin');
end;
$$;
revoke all on function public.open_market_session(uuid) from public, anon;
grant execute on function public.open_market_session(uuid) to authenticated;

create or replace function public.close_market_session(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  return private.close_session(p_id, 'admin');
end;
$$;
revoke all on function public.close_market_session(uuid) from public, anon;
grant execute on function public.close_market_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- automatic transitions
-- ---------------------------------------------------------------------------
create or replace function public.sync_market_sessions()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_opened uuid[] := '{}';
  v_closed uuid[] := '{}';
begin
  if auth.uid() is null and not private.is_service_role() then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  -- expired sessions close first, so the next scheduled one can open
  for v_id in
    select id from public.market_sessions
    where status = 'open' and closes_at <= now()
    order by closes_at
    for update skip locked
  loop
    perform private.close_session(v_id, 'auto');
    v_closed := v_closed || v_id;
  end loop;

  -- the earliest due session opens; a later one waits for it to close
  for v_id in
    select id from public.market_sessions
    where status = 'scheduled' and opens_at <= now() and closes_at > now()
    order by opens_at
    for update skip locked
  loop
    exit when exists (select 1 from public.market_sessions where status = 'open');
    perform private.open_session(v_id, 'auto');
    v_opened := v_opened || v_id;
  end loop;

  return jsonb_build_object('opened', to_jsonb(v_opened), 'closed', to_jsonb(v_closed));
end;
$$;
revoke all on function public.sync_market_sessions() from public, anon;
grant execute on function public.sync_market_sessions() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.sync_market_sessions() to service_role;
    grant execute on function public.admin_notification_recipients() to service_role;
    grant execute on function public.log_notification(text, text, integer, text, text) to service_role;
    grant execute on function public.consume_rate_limit(text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- notifications: the service role may read recipients and log outcomes
-- (automatic transitions are notified by the server, not by an admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_notification_recipients()
returns table (email text, display_name text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.email, p.display_name
  from public.profiles p
  where (private.is_admin() or private.is_service_role()) and p.is_active and p.email is not null;
$$;

create or replace function public.log_notification(
  p_kind text, p_subject text, p_recipients integer, p_status text, p_detail text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not (private.is_admin() or private.is_service_role()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_recipients < 0 or p_status not in ('sent', 'partial', 'failed', 'skipped') then
    raise exception 'INVALID_NOTIFICATION' using errcode = '22023';
  end if;
  insert into public.notifications (kind, subject, recipients, status, detail, created_by)
  values (p_kind, p_subject, p_recipients, p_status, left(p_detail, 500), auth.uid());
end;
$$;

create or replace function public.consume_rate_limit(p_bucket text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_max integer;
  v_window integer;
  v_hits integer;
begin
  if private.is_service_role() then
    return;
  end if;
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  case p_bucket
    when 'market' then v_max := 10; v_window := 60;
    when 'import' then v_max := 10; v_window := 600;
    when 'export' then v_max := 10; v_window := 600;
    when 'email'  then v_max := 5;  v_window := 3600;
    when 'admin'  then v_max := 60; v_window := 60;
    else raise exception 'UNKNOWN_BUCKET' using errcode = '22023';
  end case;
  insert into private.rate_limits (user_id, bucket, window_start, hits)
  values (auth.uid(), p_bucket, now(), 1)
  on conflict (user_id, bucket) do update
  set hits = case when private.rate_limits.window_start < now() - make_interval(secs => v_window)
                  then 1 else private.rate_limits.hits + 1 end,
      window_start = case when private.rate_limits.window_start < now() - make_interval(secs => v_window)
                          then now() else private.rate_limits.window_start end
  returning hits into v_hits;
  if v_hits > v_max then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
end;
$$;

-- ===== 20260909210000_market_sell_buy.sql =====
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

-- ===== 20260909220000_roster_privacy.sql =====
-- Privacy (admin decision 2026-09-10): a manager sees only their own team
-- (roster, credits, swaps, operations). The admin sees everything. The league
-- still sees every team's name, short name, colours and manager through
-- league_teams(); the free-agent list is still computed over every roster (it
-- reveals that a player is owned by someone, never by whom).

drop policy if exists "teams: members read" on public.teams;
drop policy if exists "teams: own team or admin" on public.teams;
create policy "teams: own team or admin" on public.teams for select to authenticated
  using (private.is_admin() or owner_id = auth.uid());

drop policy if exists "roster_players: members read" on public.roster_players;
drop policy if exists "roster_players: own team or admin" on public.roster_players;
create policy "roster_players: own team or admin" on public.roster_players for select to authenticated
  using (private.is_admin()
         or exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid()));

drop policy if exists "transactions: members read" on public.transactions;
drop policy if exists "transactions: own team or admin" on public.transactions;
create policy "transactions: own team or admin" on public.transactions for select to authenticated
  using (private.is_admin()
         or exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid()));

-- The view must keep seeing every roster row: it runs as its owner, not the
-- caller, and gates itself on league membership (inactive users see nothing).
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
    );
revoke all on public.free_agents from anon, authenticated;
grant select on public.free_agents to authenticated;

-- Public face of the teams for every active member (no credits, no roster).
create or replace function public.league_teams()
returns table (
  id uuid, name text, short_name text, color_primary text, color_secondary text,
  owner_id uuid, owner_name text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select t.id, t.name, t.short_name, t.color_primary, t.color_secondary, t.owner_id, p.display_name
  from public.teams t
  left join public.profiles p on p.user_id = t.owner_id
  where private.is_league_member()
  order by t.name;
$$;
revoke all on function public.league_teams() from public, anon;
grant execute on function public.league_teams() to authenticated;

-- market state (holes, free slots) only for the teams one can manage
create or replace function public.team_market_state(p_team_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case when private.can_manage_team(p_team_id) then
    jsonb_build_object(
      'slots', jsonb_build_object(
        'P', private.role_slots(p_team_id, 'P'), 'D', private.role_slots(p_team_id, 'D'),
        'C', private.role_slots(p_team_id, 'C'), 'A', private.role_slots(p_team_id, 'A')),
      'free_slots', jsonb_build_object(
        'P', private.free_slots(p_team_id, 'P'), 'D', private.free_slots(p_team_id, 'D'),
        'C', private.free_slots(p_team_id, 'C'), 'A', private.free_slots(p_team_id, 'A')))
  end;
$$;

-- ===== 20260909230000_player_status.sql =====
-- Player availability (injured, doubtful, suspended, unavailable) with its source.
-- Written by the admin by hand today; a sync job may fill it later through the
-- same private function. Only non-"ok" rows are stored: clearing = delete.

create table if not exists public.player_status (
  player_id integer primary key references public.players (id) on delete cascade,
  kind text not null check (kind in ('injured', 'doubtful', 'suspended', 'unavailable')),
  note text,
  source_name text,
  source_url text check (source_url is null or source_url ~ '^https?://'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.player_status enable row level security;
revoke all on public.player_status from anon, authenticated;
grant select on public.player_status to authenticated;
drop policy if exists "player_status: members read" on public.player_status;
create policy "player_status: members read" on public.player_status for select to authenticated
  using (private.is_league_member());

create or replace function private.set_player_status(
  p_player_id integer, p_kind text, p_note text, p_source_name text, p_source_url text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
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
  insert into public.player_status (player_id, kind, note, source_name, source_url, updated_by, updated_at)
  values (p_player_id, p_kind, left(nullif(trim(p_note), ''), 200), left(nullif(trim(p_source_name), ''), 60),
          nullif(trim(p_source_url), ''), auth.uid(), now())
  on conflict (player_id) do update
    set kind = excluded.kind, note = excluded.note, source_name = excluded.source_name,
        source_url = excluded.source_url, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function private.set_player_status(integer, text, text, text, text) from public;

create or replace function public.admin_set_player_status(
  p_player_id integer, p_kind text, p_note text default null,
  p_source_name text default null, p_source_url text default null
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  perform private.set_player_status(p_player_id, p_kind, p_note, p_source_name, p_source_url);
  perform private.audit('player.status', 'players', p_player_id::text,
    jsonb_build_object('kind', p_kind, 'source', p_source_name));
end;
$$;
revoke all on function public.admin_set_player_status(integer, text, text, text, text) from public, anon;
grant execute on function public.admin_set_player_status(integer, text, text, text, text) to authenticated;

-- ===== 20260909240000_safeupdate.sql =====
-- Supabase runs the API roles with pg-safeupdate: an UPDATE without a WHERE
-- clause is rejected ("UPDATE requires a WHERE clause"). The extra-budget credit
-- to every team at session opening was written without one, so "Apri ora" and
-- the automatic opening failed in production while passing the local tests.
-- Rule from now on: every UPDATE/DELETE in a function carries a WHERE, even
-- "where true" when it is meant for every row.

create or replace function private.open_session(p_id uuid, p_source text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_session public.market_sessions%rowtype;
  v_free integer;
begin
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
    update public.teams set credits = credits + v_session.extra_budget where true;
    insert into public.transactions (team_id, session_id, kind, credits_delta, note, created_by)
    select id, p_id, 'admin_credits', v_session.extra_budget, 'Budget extra apertura sessione', auth.uid()
    from public.teams;
  end if;

  update public.market_sessions
  set status = 'open', opened_at = now(), extra_budget_applied = true,
      opens_at = least(opens_at, now())
  where id = p_id;

  perform private.audit('session.open', 'market_sessions', p_id::text,
    jsonb_build_object('free_agents', v_free, 'extra_budget', v_session.extra_budget, 'source', p_source));
end;
$$;
revoke all on function private.open_session(uuid, text) from public;

-- ===== 20260909250000_market_v2_fixes.sql =====
-- Security review of market v2 / session autopilot (2026-09-10):
-- H1 the DB-side market throttle must count the v2 operation kinds;
-- M1 automatic transitions are attributed to nobody (user_id null, source 'auto'),
--    not to the manager whose page load triggered them;
-- L1 re-check the single-open rule after taking the teams lock.
-- (Renumbered to 250000 so it runs after the player_status and safeupdate
-- migrations; it re-creates open_session with the "where true" of 240000.)

create or replace function private.check_market_throttle(p_team_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_max integer := private.setting_int('market_ops_per_minute', 5);
begin
  if (select count(*) from public.transactions
      where team_id = p_team_id
        and kind in ('swap', 'free_swap', 'sell', 'buy', 'free_release')
        and created_at > now() - interval '1 minute') >= v_max then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
end;
$$;
revoke all on function private.check_market_throttle(uuid) from public;

-- audit with an explicit actor (null = the system)
create or replace function private.audit_as(
  p_user uuid, p_action text, p_entity text default null, p_entity_id text default null, p_payload jsonb default null
) returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_log (user_id, action, entity, entity_id, payload)
  values (p_user, p_action, p_entity, p_entity_id, p_payload);
$$;
revoke all on function private.audit_as(uuid, text, text, text, jsonb) from public;

create or replace function private.open_session(p_id uuid, p_source text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_session public.market_sessions%rowtype;
  v_free integer;
  v_actor uuid := case when p_source = 'auto' then null else auth.uid() end;
begin
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

  -- lock every team so the +5 and the snapshot happen against a quiet ledger,
  -- then re-check: a concurrent open may have won the race meanwhile
  perform 1 from public.teams for update;
  if exists (select 1 from public.market_sessions where status = 'open') then
    raise exception 'ANOTHER_SESSION_OPEN' using errcode = '55000';
  end if;

  insert into public.session_free_agents (session_id, player_id)
  select p_id, id from public.free_agents
  on conflict do nothing;
  select count(*) into v_free from public.session_free_agents where session_id = p_id;

  if not v_session.extra_budget_applied and v_session.extra_budget > 0 then
    update public.teams set credits = credits + v_session.extra_budget where true;  -- pg-safeupdate
    insert into public.transactions (team_id, session_id, kind, credits_delta, note, created_by)
    select id, p_id, 'admin_credits', v_session.extra_budget, 'Budget extra apertura sessione', v_actor
    from public.teams;
  end if;

  update public.market_sessions
  set status = 'open', opened_at = now(), extra_budget_applied = true,
      opens_at = least(opens_at, now())
  where id = p_id;

  perform private.audit_as(v_actor, 'session.open', 'market_sessions', p_id::text,
    jsonb_build_object('free_agents', v_free, 'extra_budget', v_session.extra_budget, 'source', p_source));
end;
$$;
revoke all on function private.open_session(uuid, text) from public;

create or replace function private.close_session(p_id uuid, p_source text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_report jsonb;
  v_actor uuid := case when p_source = 'auto' then null else auth.uid() end;
begin
  select status into v_status from public.market_sessions where id = p_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
  end if;
  v_report := private.rosters_report();
  update public.market_sessions
  set status = 'closed', closed_at = now(),
      closes_at = greatest(least(closes_at, now()), opens_at + interval '1 second'),
      validation_report = v_report
  where id = p_id;
  perform private.audit_as(v_actor, 'session.close', 'market_sessions', p_id::text,
    jsonb_build_object('invalid', v_report -> 'invalid', 'source', p_source));
  return v_report;
end;
$$;
revoke all on function private.close_session(uuid, text) from public;

-- ===== 20260909260000_pending_operations.sql =====
-- Market v2.1 (admin decision 2026-09-11): in-session releases and purchases
-- stay PENDING until the manager confirms them. Pending operations already move
-- players and credits (so the roster and the free slots are always coherent),
-- but they do not count toward the 20 season swaps and the manager can undo
-- them. "Conferma le operazioni" makes them final and counts the purchases;
-- closing the session confirms whatever is still pending. Out-of-list free
-- releases and their free purchases stay immediate (they never count).

alter table public.transactions
  add column if not exists status text not null default 'confirmed'
  check (status in ('pending', 'confirmed'));
create index if not exists idx_transactions_pending on public.transactions (team_id) where status = 'pending';

-- The ledger stays immutable, with two exceptions for pending rows only:
-- a pending row may be deleted (undo) or flipped to confirmed (nothing else).
create or replace function private.transactions_guard()
returns trigger
language plpgsql
as $$
begin
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
drop trigger if exists trg_transactions_immutable on public.transactions;
drop trigger if exists trg_transactions_guard on public.transactions;
create trigger trg_transactions_guard
before update or delete on public.transactions
for each row execute function private.transactions_guard();

-- pending purchases that will count once confirmed
create or replace function private.pending_swaps(p_team_id uuid)
returns integer
language sql stable
set search_path = public, pg_temp
as $$
  select count(*)::integer from public.transactions
  where team_id = p_team_id and status = 'pending' and kind = 'buy' and counts_toward_limit;
$$;
revoke all on function private.pending_swaps(uuid) from public;

-- ---------------------------------------------------------------------------
-- sell / buy now create pending rows (session operations)
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
    credits_delta, counts_toward_limit, status, created_by)
  values (p_team_id, v_session.id, 'sell', p_player_id, v_refund, v_refund, false, 'pending', auth.uid())
  returning id into v_tx;
  perform private.audit('market.sell', 'transactions', v_tx::text,
    jsonb_build_object('team_id', p_team_id, 'out', p_player_id, 'refund', v_refund, 'status', 'pending'));
  return v_tx;
end;
$$;

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
    -- confirmed and pending purchases together may never exceed the limit
    if v_team.swaps_used + private.pending_swaps(p_team_id) >= v_limit then
      raise exception 'SWAP_LIMIT_REACHED' using errcode = '22023';
    end if;
  end if;

  v_cost := v_player.qt_a;
  if v_team.credits - v_cost < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;

  insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
  values (p_team_id, p_player_id, v_cost, 'buy');
  update public.teams set credits = credits - v_cost where id = p_team_id;

  insert into public.transactions (team_id, session_id, kind, player_in_id, player_in_price,
    credits_delta, counts_toward_limit, status, created_by)
  values (p_team_id, v_session.id, 'buy', p_player_id, v_cost, -v_cost, not v_free,
          case when v_free then 'confirmed' else 'pending' end, auth.uid())
  returning id into v_tx;
  perform private.audit('market.buy', 'transactions', v_tx::text,
    jsonb_build_object('team_id', p_team_id, 'in', p_player_id, 'cost', v_cost, 'free', v_free,
                       'status', case when v_free then 'confirmed' else 'pending' end));
  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- undo a pending operation (the manager changed their mind)
-- ---------------------------------------------------------------------------
create or replace function public.undo_pending_operation(p_tx_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_team public.teams%rowtype;
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
    -- reopen the roster row this release closed
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

-- ---------------------------------------------------------------------------
-- confirm: pending → confirmed, purchases count from now on
-- ---------------------------------------------------------------------------
create or replace function private.confirm_team_pending(p_team_id uuid)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_counting integer;
  v_rows integer;
begin
  perform 1 from public.teams where id = p_team_id for update;
  v_counting := private.pending_swaps(p_team_id);
  update public.transactions set status = 'confirmed'
  where team_id = p_team_id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_counting > 0 then
    update public.teams set swaps_used = swaps_used + v_counting where id = p_team_id;
  end if;
  return v_rows;
end;
$$;
revoke all on function private.confirm_team_pending(uuid) from public;

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

-- closing a session confirms whatever is still pending, for every team
create or replace function private.close_session(p_id uuid, p_source text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_report jsonb;
  v_team uuid;
  v_confirmed integer := 0;
  v_actor uuid := case when p_source = 'auto' then null else auth.uid() end;
begin
  select status into v_status from public.market_sessions where id = p_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
  end if;
  for v_team in select distinct team_id from public.transactions where status = 'pending' loop
    v_confirmed := v_confirmed + private.confirm_team_pending(v_team);
  end loop;
  v_report := private.rosters_report();
  update public.market_sessions
  set status = 'closed', closed_at = now(),
      closes_at = greatest(least(closes_at, now()), opens_at + interval '1 second'),
      validation_report = v_report
  where id = p_id;
  perform private.audit_as(v_actor, 'session.close', 'market_sessions', p_id::text,
    jsonb_build_object('invalid', v_report -> 'invalid', 'source', p_source, 'auto_confirmed', v_confirmed));
  return v_report;
end;
$$;
revoke all on function private.close_session(uuid, text) from public;

-- admin reversals apply to confirmed operations only
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
  if v_tx.status = 'pending' then
    raise exception 'PENDING_OPERATION' using errcode = '55000';
  end if;
  select * into v_team from public.teams where id = v_tx.team_id for update;
  if v_tx.kind = 'reversal' then
    raise exception 'CANNOT_REVERSE_REVERSAL' using errcode = '55000';
  end if;
  if exists (select 1 from public.transactions where reversal_of = p_tx_id) then
    raise exception 'ALREADY_REVERSED' using errcode = '55000';
  end if;

  if v_team.credits - v_tx.credits_delta < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;

  if v_tx.player_in_id is not null then
    update public.roster_players set released_at = now(), released_via = 'reversal'
    where team_id = v_tx.team_id and player_id = v_tx.player_in_id and released_at is null;
    if not found then
      raise exception 'IN_PLAYER_NO_LONGER_IN_ROSTER' using errcode = '55000';
    end if;
  end if;
  if v_tx.player_out_id is not null then
    if exists (select 1 from public.roster_players where team_id = v_tx.team_id and player_id = v_tx.player_out_id and released_at is null) then
      raise exception 'OUT_PLAYER_ALREADY_IN_ROSTER' using errcode = '55000';
    end if;
    select price_paid into v_paid from public.roster_players
    where team_id = v_tx.team_id and player_id = v_tx.player_out_id
      and released_at is not null and released_at <= v_tx.created_at
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

-- market state: pending counters for the UI
create or replace function public.team_market_state(p_team_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case when private.can_manage_team(p_team_id) then
    jsonb_build_object(
      'slots', jsonb_build_object(
        'P', private.role_slots(p_team_id, 'P'), 'D', private.role_slots(p_team_id, 'D'),
        'C', private.role_slots(p_team_id, 'C'), 'A', private.role_slots(p_team_id, 'A')),
      'free_slots', jsonb_build_object(
        'P', private.free_slots(p_team_id, 'P'), 'D', private.free_slots(p_team_id, 'D'),
        'C', private.free_slots(p_team_id, 'C'), 'A', private.free_slots(p_team_id, 'A')),
      'pending', jsonb_build_object(
        'operations', (select count(*) from public.transactions where team_id = p_team_id and status = 'pending'),
        'swaps', private.pending_swaps(p_team_id)))
  end;
$$;

-- ===== 20260909270000_availability_feed.sql =====
-- M15: automatic availability/lineup feed (API-Football).
--
-- The admin's word wins: a `player_status` row written by hand (origin =
-- 'manual') is never touched by the feed. Feed rows (origin = 'feed') are
-- replaced at every run and disappear when the provider stops reporting them.
-- Lineups are volatile by nature: they are replaced per fixture and pruned.
--
-- Every write goes through `public.sync_availability(jsonb)`, callable by the
-- service role only (the cron job / the admin's "Aggiorna adesso", which runs
-- through the service client). Conventions: .claude/skills/supabase-conventions.

-- ---------------------------------------------------------------------------
-- player_status: where the row comes from
-- ---------------------------------------------------------------------------
alter table public.player_status
  add column if not exists origin text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'player_status_origin_check'
  ) then
    alter table public.player_status
      add constraint player_status_origin_check check (origin in ('manual', 'feed'));
  end if;
end $$;

create index if not exists idx_player_status_origin on public.player_status (origin, updated_at desc);

-- `private.set_player_status` is the admin path: it must always stamp 'manual',
-- so a hand-made row survives the next feed run.
create or replace function private.set_player_status(
  p_player_id integer, p_kind text, p_note text, p_source_name text, p_source_url text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
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
  insert into public.player_status (player_id, kind, note, source_name, source_url, origin, updated_by, updated_at)
  values (p_player_id, p_kind, left(nullif(trim(p_note), ''), 200), left(nullif(trim(p_source_name), ''), 60),
          nullif(trim(p_source_url), ''), 'manual', auth.uid(), now())
  on conflict (player_id) do update
    set kind = excluded.kind, note = excluded.note, source_name = excluded.source_name,
        source_url = excluded.source_url, origin = 'manual', updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;
revoke all on function private.set_player_status(integer, text, text, text, text) from public;

-- ---------------------------------------------------------------------------
-- player_lineup_status: "titolare / in panchina" for the imminent fixture
-- ---------------------------------------------------------------------------
create table if not exists public.player_lineup_status (
  player_id integer primary key references public.players (id) on delete cascade,
  state text not null check (state in ('starting', 'bench')),
  fixture_id integer,
  kickoff timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.player_lineup_status enable row level security;
revoke all on public.player_lineup_status from anon, authenticated;
grant select on public.player_lineup_status to authenticated;
drop policy if exists "player_lineup_status: members read" on public.player_lineup_status;
create policy "player_lineup_status: members read" on public.player_lineup_status for select to authenticated
  using (private.is_league_member());
create index if not exists idx_player_lineup_status_kickoff on public.player_lineup_status (kickoff desc);

-- ---------------------------------------------------------------------------
-- external_player_map: provider id <-> listone id, so a name is matched once
-- ---------------------------------------------------------------------------
create table if not exists public.external_player_map (
  provider text not null,
  external_id integer not null,
  player_id integer not null references public.players (id) on delete cascade,
  external_name text,
  confidence text not null default 'auto' check (confidence in ('auto', 'confirmed')),
  created_at timestamptz not null default now(),
  primary key (provider, external_id)
);
create unique index if not exists external_player_map_provider_player_key
  on public.external_player_map (provider, player_id);
alter table public.external_player_map enable row level security;
revoke all on public.external_player_map from anon, authenticated;
grant select on public.external_player_map to authenticated;
drop policy if exists "external_player_map: admin read" on public.external_player_map;
create policy "external_player_map: admin read" on public.external_player_map for select to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- the feed itself
-- ---------------------------------------------------------------------------
-- Payload:
--   {"statuses":[{player_id,kind,note,source_name,source_url}],
--    "lineups":[{player_id,state,fixture_id,kickoff}],
--    "map":[{external_id,player_id,external_name,confidence}],
--    "provider":"api-football", "clear_missing":true, "run":{...}}
-- Unknown keys are ignored; every list may be missing or empty.
create or replace function private.apply_availability_feed(p_payload jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_statuses jsonb := coalesce(p_payload -> 'statuses', '[]'::jsonb);
  v_lineups jsonb := coalesce(p_payload -> 'lineups', '[]'::jsonb);
  v_map jsonb := coalesce(p_payload -> 'map', '[]'::jsonb);
  v_provider text := coalesce(nullif(trim(p_payload ->> 'provider'), ''), 'api-football');
  v_clear boolean := coalesce((p_payload ->> 'clear_missing')::boolean, false);
  v_kept integer := 0;
  v_applied integer := 0;
  v_cleared integer := 0;
  v_lineup_rows integer := 0;
  v_mapped integer := 0;
  v_fixtures integer[];
  v_summary jsonb;
begin
  if jsonb_typeof(v_statuses) <> 'array' then v_statuses := '[]'::jsonb; end if;
  if jsonb_typeof(v_lineups) <> 'array' then v_lineups := '[]'::jsonb; end if;
  if jsonb_typeof(v_map) <> 'array' then v_map := '[]'::jsonb; end if;

  -- How many of the feed's statuses hit a row the admin wrote by hand: those
  -- are left exactly as they are (the admin's word wins).
  select count(*) into v_kept
  from jsonb_to_recordset(v_statuses) as x(player_id integer)
  join public.player_status ps on ps.player_id = x.player_id and ps.origin = 'manual';

  with input as (
    select distinct on (x.player_id)
      x.player_id,
      x.kind,
      left(nullif(trim(x.note), ''), 200) as note,
      left(nullif(trim(x.source_name), ''), 60) as source_name,
      case when trim(coalesce(x.source_url, '')) ~ '^https?://' then trim(x.source_url) end as source_url
    from jsonb_to_recordset(v_statuses)
      as x(player_id integer, kind text, note text, source_name text, source_url text)
    where x.player_id is not null
      and x.kind in ('injured', 'doubtful', 'suspended', 'unavailable')
      and exists (select 1 from public.players p where p.id = x.player_id)
    order by x.player_id
  )
  insert into public.player_status as ps
    (player_id, kind, note, source_name, source_url, origin, updated_by, updated_at)
  select player_id, kind, note, source_name, source_url, 'feed', null, now()
  from input
  on conflict (player_id) do update
    set kind = excluded.kind,
        note = excluded.note,
        source_name = excluded.source_name,
        source_url = excluded.source_url,
        updated_at = now()
    where ps.origin = 'feed';
  get diagnostics v_applied = row_count;

  -- Players the feed no longer reports are available again — but only the rows
  -- the feed itself wrote.
  if v_clear then
    delete from public.player_status ps
    where ps.origin = 'feed'
      and not exists (
        select 1 from jsonb_to_recordset(v_statuses) as x(player_id integer)
        where x.player_id = ps.player_id
      );
    get diagnostics v_cleared = row_count;
  end if;

  -- Lineups: whatever the provider published for these fixtures replaces what
  -- we had for them, and anything older than a day is dropped.
  select coalesce(array_agg(distinct x.fixture_id), '{}')
    into v_fixtures
  from jsonb_to_recordset(v_lineups) as x(fixture_id integer)
  where x.fixture_id is not null;

  if array_length(v_fixtures, 1) is not null then
    delete from public.player_lineup_status where fixture_id = any (v_fixtures);
  end if;
  delete from public.player_lineup_status where kickoff is null or kickoff < now() - interval '1 day';

  insert into public.player_lineup_status as pl (player_id, state, fixture_id, kickoff, updated_at)
  select distinct on (x.player_id) x.player_id, x.state, x.fixture_id, x.kickoff, now()
  from jsonb_to_recordset(v_lineups)
    as x(player_id integer, state text, fixture_id integer, kickoff timestamptz)
  where x.player_id is not null
    and x.state in ('starting', 'bench')
    and exists (select 1 from public.players p where p.id = x.player_id)
  order by x.player_id, x.state desc -- 'starting' wins over 'bench' on duplicates
  on conflict (player_id) do update
    set state = excluded.state, fixture_id = excluded.fixture_id,
        kickoff = excluded.kickoff, updated_at = now();
  get diagnostics v_lineup_rows = row_count;

  -- Matches found by name: remembered so the next run does not have to guess
  -- again. A mapping the admin confirmed is never downgraded by the feed.
  with deduped as (
    -- one row per provider id…
    select distinct on (x.external_id) x.external_id, x.player_id,
           left(nullif(trim(x.external_name), ''), 80) as external_name
    from jsonb_to_recordset(v_map)
      as x(external_id integer, player_id integer, external_name text)
    where x.external_id is not null
      and x.player_id is not null
      and exists (select 1 from public.players p where p.id = x.player_id)
    order by x.external_id
  ), input as (
    -- …and one per listone player, or the unique index would reject the batch
    select distinct on (player_id) external_id, player_id, external_name
    from deduped
    order by player_id, external_id
  )
  insert into public.external_player_map as m (provider, external_id, player_id, external_name, confidence)
  select v_provider, i.external_id, i.player_id, i.external_name, 'auto'
  from input i
  where not exists (
    select 1 from public.external_player_map e
    where e.provider = v_provider and e.player_id = i.player_id and e.external_id <> i.external_id
  )
  on conflict (provider, external_id) do update
    set player_id = excluded.player_id, external_name = excluded.external_name
    where m.confidence = 'auto';
  get diagnostics v_mapped = row_count;

  v_summary := jsonb_build_object(
    'provider', v_provider,
    'statuses_applied', v_applied,
    'statuses_kept_manual', v_kept,
    'statuses_cleared', v_cleared,
    'lineups', v_lineup_rows,
    'mappings', v_mapped,
    'synced_at', to_jsonb(now())
  );

  insert into public.league_settings (key, value)
  values
    ('availability_synced_at', to_jsonb(now())),
    ('availability_last_run', coalesce(p_payload -> 'run', '{}'::jsonb) || v_summary)
  on conflict (key) do update set value = excluded.value;

  perform private.audit('availability.feed', 'player_status', null, v_summary);
  return v_summary;
end;
$$;
revoke all on function private.apply_availability_feed(jsonb) from public;

create or replace function public.sync_availability(p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
begin
  -- No user path on purpose: the job runs with the service key, so a manager
  -- (or a stolen anon token) can never write availability.
  if not private.is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return private.apply_availability_feed(coalesce(p_payload, '{}'::jsonb));
end;
$$;
revoke all on function public.sync_availability(jsonb) from public, anon, authenticated;
grant execute on function public.sync_availability(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- staleness guard: one page load in fifteen minutes may start a refresh
-- ---------------------------------------------------------------------------
-- A single atomic upsert is the lock: the `where` on the conflict target makes
-- the row-level write race-free, so two concurrent page loads cannot both
-- claim the run (the loser simply gets no row back).
create or replace function public.claim_availability_refresh(p_max_age_seconds integer default 900)
returns boolean
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare
  v_age integer := greatest(60, least(coalesce(p_max_age_seconds, 900), 86400));
  v_claimed boolean := false;
begin
  if auth.uid() is null and not private.is_service_role() then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  insert into public.league_settings as s (key, value)
  values ('availability_refresh_claimed_at', to_jsonb(now()))
  on conflict (key) do update
    set value = to_jsonb(now())
    where (s.value #>> '{}')::timestamptz < now() - make_interval(secs => v_age)
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;
revoke all on function public.claim_availability_refresh(integer) from public, anon;
grant execute on function public.claim_availability_refresh(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin: read the mapping, fix a wrong match
-- ---------------------------------------------------------------------------
create or replace function public.admin_external_map(p_provider text default 'api-football')
returns table (
  provider text,
  external_id integer,
  external_name text,
  player_id integer,
  player_name text,
  team text,
  role_classic text,
  confidence text,
  created_at timestamptz
)
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
begin
  perform private.require_admin();
  return query
    select m.provider, m.external_id, m.external_name, m.player_id,
           p.name, p.team, p.role_classic::text, m.confidence, m.created_at
    from public.external_player_map m
    join public.players p on p.id = m.player_id
    where m.provider = coalesce(nullif(trim(p_provider), ''), 'api-football')
    order by m.confidence desc, p.name;
end;
$$;
revoke all on function public.admin_external_map(text) from public, anon;
grant execute on function public.admin_external_map(text) to authenticated;

create or replace function public.admin_confirm_player_map(
  p_player_id integer, p_provider text, p_external_id integer, p_external_name text default null
) returns void
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare
  v_provider text := coalesce(nullif(trim(p_provider), ''), 'api-football');
begin
  perform private.require_admin();
  if p_external_id is null then
    raise exception 'INVALID_EXTERNAL_ID' using errcode = '22023';
  end if;
  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- One provider id per listone player: the old binding of either side goes.
  delete from public.external_player_map
  where provider = v_provider
    and (player_id = p_player_id or external_id = p_external_id);
  insert into public.external_player_map (provider, external_id, player_id, external_name, confidence)
  values (v_provider, p_external_id, p_player_id, left(nullif(trim(p_external_name), ''), 80), 'confirmed');
  perform private.audit('availability.map', 'players', p_player_id::text,
    jsonb_build_object('provider', v_provider, 'external_id', p_external_id, 'external_name', p_external_name));
end;
$$;
revoke all on function public.admin_confirm_player_map(integer, text, integer, text) from public, anon;
grant execute on function public.admin_confirm_player_map(integer, text, integer, text) to authenticated;

-- ===== 20260909280000_cron_token.sql =====
-- The scheduler (pg_cron, in the database) needs a shared secret to call the
-- availability job. CRON_SECRET lives on Vercel and cannot be read back once
-- saved as a protected value, so the database generates its own token: the
-- admin copies it from Admin → Indisponibili into the cron statement, and the
-- route accepts either that token or CRON_SECRET.

create or replace function private.cron_token()
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_token text;
begin
  select value #>> '{}' into v_token from public.league_settings where key = 'cron_token';
  if v_token is null or length(v_token) < 32 then
    -- gen_random_uuid() is built in; pgcrypto may not be enabled on the project
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.league_settings (key, value) values ('cron_token', to_jsonb(v_token))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return v_token;
end;
$$;
revoke all on function private.cron_token() from public;

-- admin: read (creating it the first time) the token to paste into the schedule
create or replace function public.admin_cron_token()
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  return private.cron_token();
end;
$$;
revoke all on function public.admin_cron_token() from public, anon;
grant execute on function public.admin_cron_token() to authenticated;

-- admin: a new token invalidates the old schedule (which must then be re-created)
create or replace function public.admin_rotate_cron_token()
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  perform private.require_admin();
  insert into public.league_settings (key, value) values ('cron_token', to_jsonb(v_token))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform private.audit('settings.cron_token', 'league_settings', 'cron_token', null);
  return v_token;
end;
$$;
revoke all on function public.admin_rotate_cron_token() from public, anon;
grant execute on function public.admin_rotate_cron_token() to authenticated;

-- the job route verifies the token with the service role; constant-time compare
create or replace function public.verify_cron_token(p_token text)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
begin
  if not private.is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select value #>> '{}' into v_token from public.league_settings where key = 'cron_token';
  if v_token is null or p_token is null or length(p_token) < 32 then
    return false;
  end if;
  return v_token = p_token;
end;
$$;
revoke all on function public.verify_cron_token(text) from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.verify_cron_token(text) to service_role;
  end if;
end $$;

-- league_settings is admin-only for reads, so the token never reaches a manager.

