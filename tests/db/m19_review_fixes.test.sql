-- M19: the findings of the security review of the restore points and of the
-- pending free operations (2026-09-12), each one reproduced then closed.
-- H1 the free slot must still be free to undo the release that opened it.
do $$
declare
  v_admin uuid; v_mario uuid; v_a uuid; v_s uuid; v_rel uuid; v_buy uuid;
begin
  alter table public.transactions disable trigger trg_transactions_guard;
  delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  alter table public.transactions enable trigger trg_transactions_guard;
  insert into public.league_settings (key, value) values ('roster_composition', '{"P":0,"D":2,"C":0,"A":0}')
  on conflict (key) do update set value = excluded.value;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff, status) values
    (1, 'D1', 'Roma', 'D', 20, 20, 0, 'active'),
    (2, 'Gone', 'Estero', 'D', 8, 8, 0, 'out_of_list'),
    (3, 'D3', 'Como', 'D', 12, 12, 0, 'active');
  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  perform auth.test_login(v_admin, 'authenticated');
  v_a := public.admin_upsert_team(null, 'Alpha');
  perform public.admin_set_team_owner(v_a, v_mario);
  perform public.admin_assign_player(v_a, 1, 20);
  perform public.admin_assign_player(v_a, 2, 8);
  perform public.admin_set_team_credits(v_a, 100, 'test');
  v_s := public.admin_create_session('Uno', now() - interval '1 minute', now() + interval '1 hour', 0);
  perform public.open_market_session(v_s);
  perform auth.test_logout();

  perform auth.test_login(v_mario, 'authenticated');
  v_rel := public.release_out_of_list(v_a, 2);   -- free slot at D
  perform public.sell_player(v_a, 1);            -- a second hole at D
  v_buy := public.buy_player(v_a, 3);            -- paid with the free slot
  perform 1 from public.transactions where id = v_buy and not counts_toward_limit;
  if not found then raise exception 'setup: the purchase should have used the free slot'; end if;
  begin
    perform public.undo_pending_operation(v_rel);
    raise exception 'H1: the free release was undone after its slot paid for a purchase';
  exception when invalid_parameter_value then null;
  end;
  -- the honest order still works: the purchase first, then the release
  perform public.undo_pending_operation(v_buy);
  perform public.undo_pending_operation(v_rel);
  perform 1 from public.roster_players where team_id = v_a and player_id = 2 and released_at is null;
  if not found then raise exception 'the honest undo of a free release broke'; end if;
  perform auth.test_logout();
  raise notice 'm19 H1: ok';
end $$;

-- M6 a release still waiting for the closing does not make the player free.
do $$
declare
  v_admin uuid; v_mario uuid; v_luca uuid; v_a uuid; v_b uuid; v_s uuid;
begin
  alter table public.transactions disable trigger trg_transactions_guard;
  delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  alter table public.transactions enable trigger trg_transactions_guard;
  insert into public.league_settings (key, value) values ('roster_composition', '{"P":0,"D":1,"C":0,"A":0}')
  on conflict (key) do update set value = excluded.value;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff, status) values
    (1, 'Star', 'Roma', 'D', 25, 25, 0, 'active'),
    (2, 'Gone', 'Estero', 'D', 8, 8, 0, 'out_of_list');
  -- the admin of the first block: only the bootstrap email becomes admin
  select user_id into v_admin from public.profiles where role = 'admin' limit 1;
  insert into auth.users (email, raw_user_meta_data) values ('mario.b@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;
  insert into auth.users (email, raw_user_meta_data) values ('luca.b@example.com', '{"display_name": "Luca", "league_code": "SUPERLEGA-DEV"}') returning id into v_luca;

  perform auth.test_login(v_admin, 'authenticated');
  v_a := public.admin_upsert_team(null, 'Alpha');
  v_b := public.admin_upsert_team(null, 'Beta');
  perform public.admin_set_team_owner(v_a, v_mario);
  perform public.admin_set_team_owner(v_b, v_luca);
  perform public.admin_assign_player(v_a, 2, 8);    -- Alpha holds the out-of-list
  perform public.admin_assign_player(v_b, 1, 25);   -- Beta holds Star
  perform public.admin_set_team_credits(v_a, 100, 'test');
  v_s := public.admin_create_session('Uno', now() - interval '1 minute', now() + interval '1 hour', 0);
  perform public.open_market_session(v_s);
  perform auth.test_logout();

  -- Beta releases Star: pending, undoable, so Star is NOT free yet
  perform auth.test_login(v_luca, 'authenticated');
  perform public.sell_player(v_b, 1);
  perform auth.test_logout();
  perform auth.test_login(v_mario, 'authenticated');
  perform public.release_out_of_list(v_a, 2);       -- Alpha opens a free slot
  if exists (select 1 from public.free_agents where id = 1) then
    raise exception 'M6: a pending release made the player a free agent';
  end if;
  begin
    perform public.buy_player(v_a, 1);
    raise exception 'M6: a player released only pending was bought';
  exception when invalid_parameter_value then null;
  end;
  perform auth.test_logout();
  raise notice 'm19 M6: ok';
end $$;

-- M1/M2/M3/M4 the restore keeps the ledger and the counters in agreement.
do $$
declare
  v_admin uuid; v_mario uuid; v_a uuid; v_s1 uuid; v_s2 uuid; v_point uuid; v_buy uuid; v_res jsonb;
begin
  alter table public.transactions disable trigger trg_transactions_guard;
  delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  alter table public.transactions enable trigger trg_transactions_guard;
  delete from private.restore_points;
  insert into public.league_settings (key, value) values ('roster_composition', '{"P":0,"D":2,"C":0,"A":0}')
  on conflict (key) do update set value = excluded.value;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'D1', 'Roma', 'D', 20, 20, 0), (2, 'D2', 'Inter', 'D', 10, 10, 0), (3, 'D3', 'Como', 'D', 12, 12, 0);
  -- the admin of the first block: only the bootstrap email becomes admin
  select user_id into v_admin from public.profiles where role = 'admin' limit 1;
  insert into auth.users (email, raw_user_meta_data) values ('mario.c@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  perform auth.test_login(v_admin, 'authenticated');
  v_a := public.admin_upsert_team(null, 'Alpha');
  perform public.admin_set_team_owner(v_a, v_mario);
  perform public.admin_assign_player(v_a, 1, 20);
  perform public.admin_assign_player(v_a, 2, 10);
  perform public.admin_set_team_credits(v_a, 50, 'test');
  v_s1 := public.admin_create_session('Uno', now() - interval '1 minute', now() + interval '1 hour', 0);
  perform public.open_market_session(v_s1);
  perform auth.test_logout();

  -- a pending pair, then the point: it must remember that they were pending
  perform auth.test_login(v_mario, 'authenticated');
  perform public.sell_player(v_a, 1);
  v_buy := public.buy_player(v_a, 3);
  perform auth.test_logout();
  perform auth.test_login(v_admin, 'authenticated');
  v_point := public.admin_create_restore_point('Con operazioni in sospeso');
  perform auth.test_logout();

  -- the manager confirms: 1 swap counted
  perform auth.test_login(v_mario, 'authenticated');
  perform public.confirm_pending_operations(v_a);
  perform 1 from public.teams where id = v_a and swaps_used = 1;
  if not found then raise exception 'setup: the confirm did not count the swap'; end if;
  perform auth.test_logout();

  -- M3: the session of the point is closed and another one is opened
  perform auth.test_login(v_admin, 'authenticated');
  perform public.close_market_session(v_s1);
  v_s2 := public.admin_create_session('Due', now() - interval '1 minute', now() + interval '2 hours', 0);
  perform public.open_market_session(v_s2);

  v_res := public.admin_restore(v_point);
  -- M1: the kept operations are pending again and the counter agrees
  perform 1 from public.transactions where id = v_buy and status = 'pending';
  if not found then raise exception 'M1: the kept purchase was left confirmed'; end if;
  perform 1 from public.teams where id = v_a and swaps_used = 0;
  if not found then raise exception 'M1: swaps_used was not restored'; end if;
  if (v_res ->> 'transactions_reopened')::int < 1 then
    raise exception 'M1: the restore did not report the reopened operations: %', v_res;
  end if;
  -- M3: no duplicate-key failure, session one is open again, session two is not
  perform 1 from public.market_sessions where id = v_s1 and status = 'open';
  if not found then raise exception 'M3: the session of the point is not open again'; end if;
  perform 1 from public.market_sessions where id = v_s2 and status = 'scheduled';
  if not found then raise exception 'M3: the later session was not reset'; end if;
  -- M5: the removed operations are kept in the audit entry
  perform 1 from public.audit_log
  where action = 'restore.apply' and jsonb_typeof(payload -> 'removed') = 'array';
  if not found then raise exception 'M5: the removed operations were not archived'; end if;

  -- M4: the door is closed again inside the same transaction
  if coalesce(current_setting('superlega.restore', true), '') = 'on' then
    raise exception 'M4: the restore door was left open';
  end if;
  perform auth.test_logout();
  reset role;
  begin
    delete from public.transactions where team_id = v_a;
    raise exception 'M4: a confirmed row was deleted after the restore';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- M2: a team born after the point blocks the restore instead of losing data
  perform auth.test_login(v_admin, 'authenticated');
  perform public.admin_upsert_team(null, 'Beta');
  begin
    perform public.admin_restore(v_point);
    raise exception 'M2: a point older than a new team was restored';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform auth.test_logout();
  raise notice 'm19 restore fixes: ok';
end $$;
