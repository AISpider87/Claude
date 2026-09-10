-- M11: market v2 — release first, buy later, same role; free release/purchase for out-of-list.
do $$
declare
  v_admin uuid; v_mario uuid; v_luca uuid;
  v_a uuid; v_b uuid;
  v_s1 uuid;
  v_tx uuid; v_tx2 uuid; v_rev uuid;
  v_credits int; v_swaps int; v_state jsonb;
begin
  alter table public.transactions disable trigger trg_transactions_immutable;
  delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  alter table public.transactions enable trigger trg_transactions_immutable;
  -- composition for the test: 1P / 2D / 1C / 1A
  insert into public.league_settings (key, value) values ('roster_composition', '{"P":1,"D":2,"C":1,"A":1}')
  on conflict (key) do update set value = excluded.value;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'Por1', 'Roma', 'P', 10, 10, 0),
    (2, 'Def1', 'Roma', 'D', 6, 6, 0), (3, 'Def2', 'Inter', 'D', 8, 8, 0), (4, 'Def3', 'Como', 'D', 12, 12, 0), (5, 'Def4', 'Lazio', 'D', 30, 30, 0), (11, 'Def5', 'Pisa', 'D', 4, 4, 0),
    (6, 'Cen1', 'Roma', 'C', 9, 9, 0), (7, 'Cen2', 'Inter', 'C', 11, 11, 0),
    (8, 'Att1', 'Roma', 'A', 20, 20, 0), (9, 'Gone', 'Estero', 'A', 8, 8, 0), (10, 'Att2', 'Como', 'A', 15, 15, 0);
  update public.players set status = 'out_of_list', out_of_list_at = now() where id = 9;

  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;
  insert into auth.users (email, raw_user_meta_data) values ('luca@example.com', '{"display_name": "Luca", "league_code": "SUPERLEGA-DEV"}') returning id into v_luca;

  perform auth.test_login(v_admin, 'authenticated');
  v_a := public.admin_upsert_team(null, 'Alpha');
  v_b := public.admin_upsert_team(null, 'Beta');
  perform public.admin_set_team_owner(v_a, v_mario);
  perform public.admin_set_team_owner(v_b, v_luca);
  -- Alpha: full roster 1P/2D/1C/1A with the out-of-list striker; 10 credits left
  perform public.admin_assign_player(v_a, 1, 10);
  perform public.admin_assign_player(v_a, 2, 6);
  perform public.admin_assign_player(v_a, 3, 8);
  perform public.admin_assign_player(v_a, 6, 9);
  perform public.admin_assign_player(v_a, 9, 8);
  perform public.admin_set_team_credits(v_a, 10, 'test');
  perform auth.test_logout();

  -- ---------------- out of session: only the free release/purchase works
  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.sell_player(v_a, 2);
    raise exception 'sell accepted outside a session';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.buy_player(v_a, 10);
    raise exception 'buy accepted without a hole';
  exception when invalid_parameter_value then null; -- NO_ROLE_SLOT
  end;
  -- free release of the out-of-list striker: refund = price paid (8)
  v_tx := public.release_out_of_list(v_a, 9);
  perform 1 from public.teams where id = v_a and credits = 18 and swaps_used = 0;
  if not found then raise exception 'free release refund wrong'; end if;
  v_state := public.team_market_state(v_a);
  if (v_state #>> '{slots,A}')::int <> 1 or (v_state #>> '{free_slots,A}')::int <> 1 then
    raise exception 'expected one free A slot, got %', v_state;
  end if;
  begin
    perform public.release_out_of_list(v_a, 2);
    raise exception 'free release accepted for an active player';
  exception when invalid_parameter_value then null;
  end;
  -- a defender cannot fill a striker hole
  begin
    perform public.buy_player(v_a, 4);
    raise exception 'role mismatch accepted';
  exception when invalid_parameter_value then null;
  end;
  -- replacement striker bought outside the session, does not count, costs Qt.A (15)
  v_tx2 := public.buy_player(v_a, 10);
  perform 1 from public.teams where id = v_a and credits = 3 and swaps_used = 0;
  if not found then raise exception 'free purchase should not count nor overcharge'; end if;
  perform 1 from public.transactions where id = v_tx2 and kind = 'buy' and counts_toward_limit = false and player_in_price = 15 and session_id is null;
  if not found then raise exception 'free purchase ledger row wrong'; end if;
  if (public.team_market_state(v_a) #>> '{free_slots,A}')::int <> 0 then raise exception 'free slot should be consumed'; end if;
  perform auth.test_logout();

  -- ---------------- in session: release two defenders, buy two defenders
  perform auth.test_login(v_admin, 'authenticated');
  v_s1 := public.admin_create_session('Uno', now() - interval '1 minute', now() + interval '1 hour', 5);
  perform public.open_market_session(v_s1);  -- Alpha: 3 + 5 = 8 credits; free agents: 4, 5, 7, (8?) 8 is unowned too
  perform auth.test_logout();

  perform auth.test_login(v_mario, 'authenticated');
  -- Luca cannot touch Alpha
  perform auth.test_logout();
  perform auth.test_login(v_luca, 'authenticated');
  begin
    perform public.sell_player(v_a, 2);
    raise exception 'foreign manager sold a player';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  perform auth.test_login(v_mario, 'authenticated');
  -- expensive defender not affordable yet (8 credits, Def4 costs 30)
  begin
    perform public.buy_player(v_a, 5);
    raise exception 'buy accepted without a hole (2)';
  exception when invalid_parameter_value then null;
  end;
  v_tx := public.sell_player(v_a, 2);   -- +6 → 14
  perform public.sell_player(v_a, 3);   -- +8 → 22
  perform 1 from public.teams where id = v_a and credits = 22 and swaps_used = 0;
  if not found then raise exception 'sells should not count as swaps'; end if;
  if (public.team_market_state(v_a) #>> '{slots,D}')::int <> 2 then raise exception 'expected 2 D holes'; end if;
  -- a midfielder cannot fill a defender hole
  begin
    perform public.buy_player(v_a, 7);
    raise exception 'midfielder accepted for a defender hole';
  exception when invalid_parameter_value then null;
  end;
  -- Def4 (30) still too expensive: 22 credits
  begin
    perform public.buy_player(v_a, 5);
    raise exception 'unaffordable purchase accepted';
  exception when check_violation then null;
  end;
  -- a released player is not in this session's snapshot (he was owned at the opening)
  begin
    perform public.buy_player(v_a, 2);
    raise exception 'released player bought back from the same snapshot';
  exception when invalid_parameter_value then null; -- NOT_FREE_AGENT
  end;
  -- buy Def3 (12) → 10 credits, 1 swap; buy Def5 (4) → 6 credits, 2 swaps
  perform public.buy_player(v_a, 4);
  perform public.buy_player(v_a, 11);
  perform 1 from public.teams where id = v_a and credits = 6 and swaps_used = 2;
  if not found then raise exception 'purchases should count and charge Qt.A'; end if;
  if (public.team_market_state(v_a) #>> '{slots,D}')::int <> 0 then raise exception 'D holes should be filled'; end if;
  -- no hole left: a third defender is refused
  begin
    perform public.buy_player(v_a, 5);
    raise exception 'over-composition purchase accepted';
  exception when invalid_parameter_value then null;
  end;
  -- midfielder: release Cen1 (+9 → 15), buy Cen2 (11) → 4 credits, 3 swaps
  perform public.sell_player(v_a, 6);
  perform public.buy_player(v_a, 7);
  perform 1 from public.teams where id = v_a and credits = 4 and swaps_used = 3;
  if not found then raise exception 'C purchase wrong'; end if;
  perform auth.test_logout();

  -- ---------------- reversals: undo the purchase of Cen2, then the sale of Def1
  perform auth.test_login(v_admin, 'authenticated');
  select id into v_tx2 from public.transactions where team_id = v_a and kind = 'buy' and player_in_id = 7;
  v_rev := public.reverse_transaction(v_tx2, 'errore manager');
  perform 1 from public.teams where id = v_a and credits = 15 and swaps_used = 2;
  if not found then raise exception 'reversal of a purchase wrong'; end if;
  perform 1 from public.roster_players where team_id = v_a and player_id = 7 and released_at is null;
  if found then raise exception 'reversed purchase still in roster'; end if;
  v_rev := public.reverse_transaction(v_tx, 'ripensamento');
  perform 1 from public.teams where id = v_a and credits = 9 and swaps_used = 2;
  if not found then raise exception 'reversal of a sale wrong'; end if;
  perform 1 from public.roster_players where team_id = v_a and player_id = 2 and released_at is null and price_paid = 6;
  if not found then raise exception 'reversed sale did not restore the player at his old price'; end if;
  if (public.team_market_state(v_a) #>> '{slots,D}')::int <> -1 then raise exception 'D should now be over the composition'; end if;
  perform auth.test_logout();
end $$;

-- the report at close flags the hole
do $$
declare
  v_admin uuid; v_s uuid; v_report jsonb;
begin
  select user_id into v_admin from public.profiles where role = 'admin' limit 1;
  perform auth.test_login(v_admin, 'authenticated');
  select id into v_s from public.market_sessions where status = 'open' limit 1;
  v_report := public.close_market_session(v_s);
  if (v_report ->> 'invalid')::int < 1 then raise exception 'closing report should flag the roster with a hole'; end if;
  perform auth.test_logout();
end $$;
