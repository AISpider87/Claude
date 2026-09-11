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
