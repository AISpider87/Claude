-- Manager feedback 2026-09-12: "il cambio gratuito non risulta tra le operazioni
-- della sessione, quindi mentre gli altri posso ancora annullarli quello non lo
-- vedo più". Free operations (the out-of-list release and the purchase that
-- fills its free slot) were written straight as 'confirmed', so they never
-- appeared in the manager's list of operations to review and could not be
-- undone — while the ordinary sell/buy of the same session could.
--
-- From now on: inside an open session a free operation is PENDING like any
-- other (visible, undoable, confirmed at the closing); outside a session it
-- stays immediate, because there is no closing that would ever confirm it.
-- It never counts toward the 20 season swaps either way (counts_toward_limit
-- stays false), which is what the admin asked for in the first place.

-- ---------------------------------------------------------------------------
-- out-of-list release: pending while a session is open
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
    credits_delta, counts_toward_limit, status, created_by)
  values (p_team_id, v_session.id, 'free_release', p_player_id, v_refund, v_refund, false,
          case when v_session.id is null then 'confirmed' else 'pending' end, auth.uid())
  returning id into v_tx;
  perform private.audit('market.free_release', 'transactions', v_tx::text,
    jsonb_build_object('team_id', p_team_id, 'out', p_player_id, 'refund', v_refund,
                       'status', case when v_session.id is null then 'confirmed' else 'pending' end));
  return v_tx;
end;
$$;
revoke all on function public.release_out_of_list(uuid, integer) from public, anon;
grant execute on function public.release_out_of_list(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- purchase: a free purchase follows the same rule as the free release
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
  v_status text;
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

  -- a free purchase out of session is final at once (nothing would confirm it)
  v_status := case when v_session.id is null then 'confirmed' else 'pending' end;
  insert into public.transactions (team_id, session_id, kind, player_in_id, player_in_price,
    credits_delta, counts_toward_limit, status, created_by)
  values (p_team_id, v_session.id, 'buy', p_player_id, v_cost, -v_cost, not v_free, v_status, auth.uid())
  returning id into v_tx;
  perform private.audit('market.buy', 'transactions', v_tx::text,
    jsonb_build_object('team_id', p_team_id, 'in', p_player_id, 'cost', v_cost, 'free', v_free,
                       'status', v_status));
  return v_tx;
end;
$$;
revoke all on function public.buy_player(uuid, integer) from public, anon;
grant execute on function public.buy_player(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- undo: the free release is undone like the ordinary one (refund taken back,
-- roster row reopened) and, like it, only while its seat is still free (H1).
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
