-- M4: sessions, swaps, free swaps, reversals, validation. Cases from market-rules SKILL.md.
do $$
declare
  v_admin uuid; v_mario uuid; v_luca uuid;
  v_a uuid; v_b uuid;
  v_s1 uuid; v_s2 uuid;
  v_tx uuid; v_tx2 uuid; v_rev uuid;
  v_count int; v_credits int; v_swaps int;
  v_report jsonb;
begin
  -- test-only: the ledger is immutable by design; a superuser may pause the guard to reset the fixture
  alter table public.transactions disable trigger trg_transactions_immutable;
  delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  alter table public.transactions enable trigger trg_transactions_immutable;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'Por1', 'Roma', 'P', 10, 10, 0), (2, 'Por2', 'Inter', 'P', 15, 15, 0), (3, 'Por3', 'Como', 'P', 5, 5, 0),
    (4, 'Att1', 'Roma', 'A', 30, 30, 0), (5, 'Att2', 'Inter', 'A', 20, 20, 0), (6, 'Att3', 'Como', 'A', 40, 40, 0),
    (7, 'Gone', 'Estero', 'A', 8, 8, 0), (8, 'Def1', 'Roma', 'D', 6, 6, 0);
  update public.players set status = 'out_of_list', out_of_list_at = now() where id = 7;

  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;
  insert into auth.users (email, raw_user_meta_data) values ('luca@example.com', '{"display_name": "Luca", "league_code": "SUPERLEGA-DEV"}') returning id into v_luca;

  perform auth.test_login(v_admin, 'authenticated');
  v_a := public.admin_upsert_team(null, 'Alpha');
  v_b := public.admin_upsert_team(null, 'Beta');
  perform public.admin_set_team_owner(v_a, v_mario);
  perform public.admin_set_team_owner(v_b, v_luca);
  -- Alpha: Por1 (10), Att1 (30), Gone (8, out of list); Beta: Por1 (10), Att2 (20)
  perform public.admin_assign_player(v_a, 1, 10);
  perform public.admin_assign_player(v_a, 4, 30);
  perform public.admin_assign_player(v_a, 7, 8);
  perform public.admin_assign_player(v_b, 1, 10);
  perform public.admin_assign_player(v_b, 5, 20);
  perform public.admin_set_team_credits(v_a, 20, 'test');
  perform public.admin_set_team_credits(v_b, 20, 'test');

  -- sessions: create, cannot open an expired one, open snapshots free agents and credits +5
  v_s1 := public.admin_create_session('Sessione 1', now() - interval '1 hour', now() + interval '1 day', 5);
  begin
    perform public.admin_create_session('Bad', now(), now() - interval '1 hour', 5);
    raise exception 'invalid window accepted';
  exception when invalid_parameter_value then null;
  end;
  perform auth.test_logout();

  -- #2 swap outside an open session is rejected (manager, direct call)
  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.swap_player(v_a, 1, 2);
    raise exception 'swap allowed without open session';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.open_market_session(v_s1);
    raise exception 'manager opened a session';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  perform auth.test_login(v_admin, 'authenticated');
  perform public.open_market_session(v_s1);
  select count(*) into v_count from public.session_free_agents where session_id = v_s1;
  -- free now: Por2, Por3, Att3, Def1 (Gone is out of list; Por1/Att1/Att2 owned)
  if v_count <> 4 then raise exception 'snapshot should have 4 free agents, got %', v_count; end if;
  select credits into v_credits from public.teams where id = v_a;
  if v_credits <> 25 then raise exception 'extra budget not applied: %', v_credits; end if;
  -- #14 a second open is impossible (already open) and never credits twice
  begin
    perform public.open_market_session(v_s1);
    raise exception 'double open allowed';
  exception when object_not_in_prerequisite_state then null;
  end;
  select credits into v_credits from public.teams where id = v_a;
  if v_credits <> 25 then raise exception 'extra budget applied twice'; end if;
  v_s2 := public.admin_create_session('Sessione 2', now(), now() + interval '2 day', 5);
  begin
    perform public.open_market_session(v_s2);
    raise exception 'two open sessions allowed';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform auth.test_logout();

  -- #1 valid swap: Alpha sells Por1 (Qt.A 10) and buys Por2 (15): 25 + 10 - 15 = 20
  perform auth.test_login(v_mario, 'authenticated');
  v_tx := public.swap_player(v_a, 1, 2);
  select credits, swaps_used into v_credits, v_swaps from public.teams where id = v_a;
  if v_credits <> 20 or v_swaps <> 1 then raise exception 'swap result wrong: credits % swaps %', v_credits, v_swaps; end if;
  perform 1 from public.roster_players where team_id = v_a and player_id = 2 and released_at is null and price_paid = 15;
  if not found then raise exception 'incoming player missing'; end if;
  perform 1 from public.roster_players where team_id = v_a and player_id = 1 and released_at is not null and released_via = 'swap';
  if not found then raise exception 'outgoing player not released'; end if;
  perform 1 from public.transactions where id = v_tx and kind = 'swap' and credits_delta = -5 and counts_toward_limit;
  if not found then raise exception 'ledger row wrong'; end if;

  -- #5 role mismatch, #3 not in snapshot, #6 credits, own-team check
  begin
    perform public.swap_player(v_a, 4, 3);  -- Att1 out, Por3 in
    raise exception 'role mismatch accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.swap_player(v_a, 4, 5);  -- Att2 is owned by Beta: not in snapshot
    raise exception 'non-free agent accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.swap_player(v_a, 4, 6);  -- Att1 (30) -> Att3 (40): 20 + 30 - 40 = 10, ok
    -- fine, undo it below via reversal test instead: keep it
  end;
  select credits into v_credits from public.teams where id = v_a;
  if v_credits <> 10 then raise exception 'second swap credits wrong: %', v_credits; end if;
  begin
    perform public.swap_player(v_b, 1, 3);  -- Mario cannot act for Beta
    raise exception 'acted on another team';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  -- #4 the same free agent can be bought by another team in the same session
  perform auth.test_login(v_luca, 'authenticated');
  perform public.swap_player(v_b, 1, 2);  -- Beta: Por1 -> Por2 too. 25 + 10 - 15 = 20
  perform auth.test_logout();
  -- rosters are private (M12): count the owners as superuser
  select count(*) into v_count from public.roster_players where player_id = 2 and released_at is null;
  if v_count <> 2 then raise exception 'non-exclusive ownership broken: % owners', v_count; end if;
  perform auth.test_login(v_luca, 'authenticated');
  -- #6 insufficient credits: Beta (20) sells Att2 (20) for Att3 (40): 20 + 20 - 40 = 0 ok; then nothing left
  perform public.swap_player(v_b, 5, 6);
  select credits into v_credits from public.teams where id = v_b;
  if v_credits <> 0 then raise exception 'credits should be exactly 0, got %', v_credits; end if;
  -- #3 snapshot semantics: Att2 was owned at opening, so it is not buyable even after release
  begin
    perform public.swap_player(v_b, 6, 5);
    raise exception 'player outside the snapshot accepted';
  exception when invalid_parameter_value then null;
  end;
  perform auth.test_logout();

  -- #7 season limit: Beta has 2 swaps; with the limit at 2 the next one is refused
  perform auth.test_login(v_admin, 'authenticated');
  perform public.admin_set_setting('season_swap_limit', '2');
  perform auth.test_logout();
  perform auth.test_login(v_luca, 'authenticated');
  begin
    perform public.swap_player(v_b, 2, 3);  -- Por2 -> Por3 (both fine otherwise)
    raise exception 'swap limit not enforced';
  exception when invalid_parameter_value then null;
  end;
  perform auth.test_logout();

  -- an out-of-list player cannot be sold through a normal swap
  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.swap_player(v_a, 7, 5);
    raise exception 'out-of-list sold via normal swap';
  exception when invalid_parameter_value then null;
  end;

  -- #9 free swap only for out-of-list players; #6 free swap also respects credits
  begin
    perform public.free_swap_player(v_a, 6, 5);  -- Att3 is active
    raise exception 'free swap on active player accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.free_swap_player(v_a, 7, 5);  -- Gone (paid 8) -> Att2 (20): 10 + 8 - 20 < 0
    raise exception 'free swap beyond credits accepted';
  exception when check_violation then null;
  end;
  select credits, swaps_used into v_credits, v_swaps from public.teams where id = v_a;
  if v_credits <> 10 or v_swaps <> 2 then raise exception 'state changed by refused free swap'; end if;
  perform auth.test_logout();
end $$;

-- Second block: continue with a clean slate for the remaining cases.
do $$
declare
  v_admin uuid; v_mario uuid;
  v_a uuid; v_s1 uuid; v_tx uuid; v_rev uuid;
  v_count int; v_credits int; v_swaps int; v_report jsonb;
begin
  -- test-only: the ledger is immutable by design; a superuser may pause the guard to reset the fixture
  alter table public.transactions disable trigger trg_transactions_immutable;
  delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  delete from public.profiles; delete from auth.users;
  alter table public.transactions enable trigger trg_transactions_immutable;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'Por1', 'Roma', 'P', 10, 10, 0), (2, 'Por2', 'Inter', 'P', 15, 15, 0),
    (4, 'Att1', 'Roma', 'A', 30, 30, 0), (5, 'Att2', 'Inter', 'A', 20, 20, 0),
    (7, 'Gone', 'Estero', 'A', 8, 8, 0);
  update public.players set status = 'out_of_list', out_of_list_at = now() where id = 7;
  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  perform auth.test_login(v_admin, 'authenticated');
  v_a := public.admin_upsert_team(null, 'Alpha');
  perform public.admin_set_team_owner(v_a, v_mario);
  perform public.admin_assign_player(v_a, 1, 10);
  perform public.admin_assign_player(v_a, 7, 8);
  perform public.admin_set_team_credits(v_a, 30, 'test');
  perform auth.test_logout();

  -- #10 free swap with no session open, refund = price paid (8), cost = Qt.A (20): 30 + 8 - 20 = 18
  perform auth.test_login(v_mario, 'authenticated');
  v_tx := public.free_swap_player(v_a, 7, 5);
  select credits, swaps_used into v_credits, v_swaps from public.teams where id = v_a;
  if v_credits <> 18 or v_swaps <> 0 then raise exception 'free swap wrong: credits % swaps %', v_credits, v_swaps; end if;
  perform 1 from public.transactions where id = v_tx and kind = 'free_swap' and not counts_toward_limit and session_id is null and player_out_price = 8;
  if not found then raise exception 'free swap ledger row wrong'; end if;
  -- #11 incoming player must be free right now
  begin
    perform public.free_swap_player(v_a, 5, 5);
    raise exception 'free swap on non out-of-list accepted';
  exception when invalid_parameter_value then null;
  end;
  perform auth.test_logout();

  -- #12 reversal by admin restores roster, credits and (for swaps) the counter
  perform auth.test_login(v_admin, 'authenticated');
  begin
    perform public.reverse_transaction(v_tx, '');
    raise exception 'reversal without reason accepted';
  exception when invalid_parameter_value then null;
  end;
  v_rev := public.reverse_transaction(v_tx, 'Errore del manager');
  select credits into v_credits from public.teams where id = v_a;
  if v_credits <> 30 then raise exception 'reversal credits wrong: %', v_credits; end if;
  perform 1 from public.roster_players where team_id = v_a and player_id = 7 and released_at is null and price_paid = 8;
  if not found then raise exception 'reversal did not restore the outgoing player'; end if;
  perform 1 from public.roster_players where team_id = v_a and player_id = 5 and released_at is null;
  if found then raise exception 'reversal left the incoming player'; end if;
  perform 1 from public.transactions where id = v_rev and kind = 'reversal' and reversal_of = v_tx and credits_delta = 12;
  if not found then raise exception 'reversal ledger row wrong'; end if;
  begin
    perform public.reverse_transaction(v_tx, 'again');
    raise exception 'double reversal accepted';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.reverse_transaction(v_rev, 'reverse the reversal');
    raise exception 'reversal of reversal accepted';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- swap + reversal decrements swaps_used
  v_s1 := public.admin_create_session('Sessione test', now(), now() + interval '1 day', 0);
  perform public.open_market_session(v_s1);
  perform auth.test_logout();
  perform auth.test_login(v_mario, 'authenticated');
  v_tx := public.swap_player(v_a, 1, 2);  -- Por1 (10) -> Por2 (15): 30 + 10 - 15 = 25
  perform auth.test_logout();
  perform auth.test_login(v_admin, 'authenticated');
  perform public.reverse_transaction(v_tx, 'Sbagliato');
  select credits, swaps_used into v_credits, v_swaps from public.teams where id = v_a;
  if v_credits <> 30 or v_swaps <> 0 then raise exception 'swap reversal wrong: credits % swaps %', v_credits, v_swaps; end if;

  -- closing: report flags incomplete rosters (Alpha has 2 players, one out of list)
  v_report := public.close_market_session(v_s1);
  if (v_report ->> 'invalid')::int <> 1 then raise exception 'validation report wrong: %', v_report; end if;
  perform 1 from public.market_sessions where id = v_s1 and status = 'closed' and closed_at is not null and validation_report is not null;
  if not found then raise exception 'session not closed properly'; end if;
  begin
    perform public.close_market_session(v_s1);
    raise exception 'double close accepted';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform auth.test_logout();

  -- #13 after closing, direct swap calls fail again
  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.swap_player(v_a, 1, 2);
    raise exception 'swap allowed after close';
  exception when object_not_in_prerequisite_state then null;
  end;
  -- manager can read the session, the ledger and the snapshot; cannot write them
  select count(*) into v_count from public.market_sessions;
  if v_count <> 1 then raise exception 'manager cannot read sessions'; end if;
  select count(*) into v_count from public.transactions;
  if v_count < 4 then raise exception 'manager cannot read ledger'; end if;
  begin
    insert into public.session_free_agents values (v_s1, 1);
    raise exception 'manager wrote snapshot';
  exception when insufficient_privilege then null;
  end;

  -- per-user attempt limiter with server-defined limits: 'email' allows 5 per hour,
  -- the 6th is refused; unknown buckets are rejected (callers cannot pick limits)
  perform public.consume_rate_limit('email');
  perform public.consume_rate_limit('email');
  perform public.consume_rate_limit('email');
  perform public.consume_rate_limit('email');
  perform public.consume_rate_limit('email');
  begin
    perform public.consume_rate_limit('email');
    raise exception 'rate limit not enforced';
  exception when program_limit_exceeded then null;
  end;
  begin
    perform public.consume_rate_limit('made-up-bucket');
    raise exception 'unknown bucket accepted';
  exception when invalid_parameter_value then null;
  end;
  perform auth.test_logout();

  -- per-team committed-operation throttle (market_ops_per_minute): with the limit at 3
  -- and 2 swaps already committed this minute, the second swap below is refused
  perform auth.test_login(v_admin, 'authenticated');
  perform public.admin_set_setting('market_ops_per_minute', '3');  -- Alpha already has 2 committed swaps this minute
  v_s1 := public.admin_create_session('Sessione throttle', now(), now() + interval '1 day', 0);
  perform public.open_market_session(v_s1);
  perform auth.test_logout();
  perform auth.test_login(v_mario, 'authenticated');
  perform public.swap_player(v_a, 1, 2);
  begin
    perform public.swap_player(v_a, 2, 1);
    raise exception 'market throttle not enforced';
  exception when program_limit_exceeded then null;
  end;
  perform auth.test_logout();
end $$;
