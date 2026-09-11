-- M14: in-session operations are pending until confirmed; undo; auto-confirm at close.
do $$
declare
  v_admin uuid; v_mario uuid;
  v_a uuid; v_s uuid;
  v_sell uuid; v_buy uuid; v_state jsonb; v_n int;
begin
  alter table public.transactions disable trigger trg_transactions_guard;
  delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  alter table public.transactions enable trigger trg_transactions_guard;
  insert into public.league_settings (key, value) values ('roster_composition', '{"P":1,"D":2,"C":0,"A":0}')
  on conflict (key) do update set value = excluded.value;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'Por1', 'Roma', 'P', 10, 10, 0),
    (2, 'Def1', 'Roma', 'D', 6, 6, 0), (3, 'Def2', 'Inter', 'D', 8, 8, 0), (4, 'Def3', 'Como', 'D', 12, 12, 0), (5, 'Def4', 'Pisa', 'D', 4, 4, 0);
  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  perform auth.test_login(v_admin, 'authenticated');
  v_a := public.admin_upsert_team(null, 'Alpha');
  perform public.admin_set_team_owner(v_a, v_mario);
  perform public.admin_assign_player(v_a, 1, 10);
  perform public.admin_assign_player(v_a, 2, 6);
  perform public.admin_assign_player(v_a, 3, 8);
  perform public.admin_set_team_credits(v_a, 10, 'test');
  v_s := public.admin_create_session('Uno', now() - interval '1 minute', now() + interval '1 hour', 0);
  perform public.open_market_session(v_s);
  perform auth.test_logout();

  perform auth.test_login(v_mario, 'authenticated');
  -- release Def1 (+6 → 16) and buy Def3 (12 → 4): both pending, nothing counted yet
  v_sell := public.sell_player(v_a, 2);
  v_buy := public.buy_player(v_a, 4);
  perform 1 from public.teams where id = v_a and credits = 4 and swaps_used = 0;
  if not found then raise exception 'pending operations must move credits but not the counter'; end if;
  perform 1 from public.transactions where id = v_buy and status = 'pending' and counts_toward_limit;
  if not found then raise exception 'purchase should be pending'; end if;
  v_state := public.team_market_state(v_a);
  if (v_state #>> '{pending,operations}')::int <> 2 or (v_state #>> '{pending,swaps}')::int <> 1 then
    raise exception 'pending counters wrong: %', v_state;
  end if;
  -- direct edits of a pending row are still forbidden to everyone
  begin
    update public.transactions set credits_delta = 0 where id = v_buy;
    raise exception 'pending row edited directly';
  exception when insufficient_privilege or object_not_in_prerequisite_state then null;
  end;
  -- the manager changes their mind about the purchase: undo → Def3 out, 16 credits
  perform public.undo_pending_operation(v_buy);
  perform 1 from public.teams where id = v_a and credits = 16 and swaps_used = 0;
  if not found then raise exception 'undo of a purchase wrong'; end if;
  perform 1 from public.roster_players where team_id = v_a and player_id = 4 and released_at is null;
  if found then raise exception 'undone purchase still in roster'; end if;
  perform 1 from public.transactions where id = v_buy;
  if found then raise exception 'undone purchase still in the ledger'; end if;
  -- undo the release too: Def1 back at his old price, 10 credits
  perform public.undo_pending_operation(v_sell);
  perform 1 from public.teams where id = v_a and credits = 10;
  if not found then raise exception 'undo of a release wrong'; end if;
  perform 1 from public.roster_players where team_id = v_a and player_id = 2 and released_at is null and price_paid = 6;
  if not found then raise exception 'undone release did not restore the player'; end if;
  begin
    perform public.undo_pending_operation(v_sell);
    raise exception 'undo of a missing row accepted';
  exception when no_data_found then null;
  end;
  -- confirm with nothing pending is an error
  begin
    perform public.confirm_pending_operations(v_a);
    raise exception 'confirm with nothing pending accepted';
  exception when no_data_found then null;
  end;

  -- release Def1 again and buy Def4 (4): confirm → counter 1, rows confirmed
  v_sell := public.sell_player(v_a, 2);
  v_buy := public.buy_player(v_a, 5);
  v_n := public.confirm_pending_operations(v_a);
  if v_n <> 2 then raise exception 'expected 2 confirmed rows, got %', v_n; end if;
  perform 1 from public.teams where id = v_a and credits = 12 and swaps_used = 1;
  if not found then raise exception 'confirmation should count the purchase'; end if;
  perform 1 from public.transactions where id = v_buy and status = 'confirmed';
  if not found then raise exception 'row not confirmed'; end if;
  begin
    perform public.undo_pending_operation(v_buy);
    raise exception 'confirmed row undone';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- a pending purchase left open is confirmed by the closing
  perform public.sell_player(v_a, 5);        -- +4 → 16
  v_buy := public.buy_player(v_a, 3 + 1);    -- Def3 (12) → 4, pending
  perform auth.test_logout();

  perform auth.test_login(v_admin, 'authenticated');
  -- admin cannot reverse a pending row
  begin
    perform public.reverse_transaction(v_buy, 'test');
    raise exception 'admin reversed a pending row';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform public.close_market_session(v_s);
  perform 1 from public.teams where id = v_a and swaps_used = 2;
  if not found then raise exception 'closing should confirm and count the pending purchase'; end if;
  perform 1 from public.transactions where status = 'pending';
  if found then raise exception 'pending rows left after closing'; end if;
  perform 1 from public.audit_log where action = 'session.close' and (payload ->> 'auto_confirmed')::int = 2;
  if not found then raise exception 'closing audit should report the auto-confirmed rows'; end if;
  perform auth.test_logout();
end $$;

-- Security review H1/L13: undoing a release whose seat was refilled would leave
-- the roster over the composition; undo and confirm need an open session.
do $$
declare
  v_admin uuid; v_mario uuid; v_a uuid; v_s uuid; v_sell uuid; v_count int;
begin
  alter table public.transactions disable trigger trg_transactions_guard;
  delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
  delete from public.roster_players; delete from public.teams; delete from public.players;
  alter table public.transactions enable trigger trg_transactions_guard;
  insert into public.league_settings (key, value) values ('roster_composition', '{"P":0,"D":2,"C":0,"A":0}')
  on conflict (key) do update set value = excluded.value;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'Def1', 'Roma', 'D', 6, 6, 0), (2, 'Def2', 'Inter', 'D', 8, 8, 0), (3, 'Def3', 'Como', 'D', 5, 5, 0);
  select user_id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_admin is null then
    insert into auth.users (email, raw_user_meta_data) values ('admin2@superlega.local', '{"display_name": "D", "league_code": "superlega-dev"}') returning id into v_admin;
  end if;
  insert into auth.users (email, raw_user_meta_data) values ('mario2@example.com', '{"display_name": "M", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  perform auth.test_login(v_admin, 'authenticated');
  v_a := public.admin_upsert_team(null, 'Alpha');
  perform public.admin_set_team_owner(v_a, v_mario);
  perform public.admin_assign_player(v_a, 1, 6);
  perform public.admin_assign_player(v_a, 2, 8);
  perform public.admin_set_team_credits(v_a, 50, 'test');
  v_s := public.admin_create_session('Uno', now() - interval '1 minute', now() + interval '1 hour', 0);
  perform public.open_market_session(v_s);
  perform auth.test_logout();

  perform auth.test_login(v_mario, 'authenticated');
  v_sell := public.sell_player(v_a, 1);     -- D hole
  perform public.buy_player(v_a, 3);        -- hole filled (pending)
  begin
    perform public.undo_pending_operation(v_sell);
    raise exception 'undo of a refilled release accepted (roster would exceed the composition)';
  exception when invalid_parameter_value then null;  -- NO_ROLE_SLOT
  end;
  select count(*) into v_count from public.roster_players r join public.players p on p.id = r.player_id
  where r.team_id = v_a and r.released_at is null and p.role_classic = 'D';
  if v_count <> 2 then raise exception 'composition broken: % defenders', v_count; end if;
  perform auth.test_logout();

  -- once the window is over, neither undo nor confirm works
  update public.market_sessions set closes_at = now() - interval '1 second' where id = v_s;
  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.confirm_pending_operations(v_a);
    raise exception 'confirm accepted after the session window';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform auth.test_logout();
end $$;
