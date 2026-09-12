-- M18: restore points. The admin can take the league back to a labelled
-- photograph (rosters, credits, season swaps, sessions) and the operations
-- that came after it are removed. Managers cannot see or use any of this.
do $$
declare
  v_admin uuid; v_mario uuid;
  v_a uuid; v_s uuid; v_point uuid; v_result jsonb; v_n integer;
begin
  alter table public.transactions disable trigger trg_transactions_guard;
  delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  alter table public.transactions enable trigger trg_transactions_guard;
  delete from private.restore_points;
  insert into public.league_settings (key, value) values ('roster_composition', '{"P":1,"D":2,"C":0,"A":0}')
  on conflict (key) do update set value = excluded.value;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'Por1', 'Roma', 'P', 10, 10, 0), (2, 'Def1', 'Roma', 'D', 6, 6, 0),
    (3, 'Def2', 'Inter', 'D', 8, 8, 0), (4, 'Def3', 'Como', 'D', 12, 12, 0);
  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  perform auth.test_login(v_admin, 'authenticated');
  v_a := public.admin_upsert_team(null, 'Alpha');
  perform public.admin_set_team_owner(v_a, v_mario);
  perform public.admin_assign_player(v_a, 1, 10);
  perform public.admin_assign_player(v_a, 2, 6);
  perform public.admin_assign_player(v_a, 3, 8);
  perform public.admin_set_team_credits(v_a, 20, 'rose importate');

  -- the photograph: this is the state to come back to
  v_point := public.admin_create_restore_point('Rose importate');
  select operations_after into v_n from public.admin_restore_points() where id = v_point;
  if v_n <> 0 then raise exception 'a fresh point should have no later operations, got %', v_n; end if;

  -- a session runs: release Def1, buy Def3, confirm (1 swap counted)
  v_s := public.admin_create_session('Uno', now() - interval '1 minute', now() + interval '1 hour', 5);
  perform public.open_market_session(v_s);
  perform auth.test_logout();
  perform auth.test_login(v_mario, 'authenticated');
  perform public.sell_player(v_a, 2);
  perform public.buy_player(v_a, 4);
  perform public.confirm_pending_operations(v_a);
  perform 1 from public.teams where id = v_a and swaps_used = 1;
  if not found then raise exception 'the session did not count the swap'; end if;

  -- a manager may not touch restore points
  begin
    perform public.admin_create_restore_point('mio');
    raise exception 'a manager created a restore point';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_restore(v_point);
    raise exception 'a manager restored the league';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.admin_restore_points();
    raise exception 'a manager listed the restore points';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  perform auth.test_login(v_admin, 'authenticated');
  select operations_after into v_n from public.admin_restore_points() where id = v_point;
  if v_n < 2 then raise exception 'the point should see the later operations, got %', v_n; end if;

  -- back to the photograph
  v_result := public.admin_restore(v_point);
  if (v_result ->> 'transactions_deleted')::int < 2 then
    raise exception 'the later operations were not removed: %', v_result;
  end if;
  perform 1 from public.teams where id = v_a and credits = 20 and swaps_used = 0;
  if not found then raise exception 'credits and season swaps were not restored'; end if;
  perform 1 from public.roster_players where team_id = v_a and player_id = 2 and released_at is null and price_paid = 6;
  if not found then raise exception 'the released player is not back in the roster'; end if;
  perform 1 from public.roster_players where team_id = v_a and player_id = 4;
  if found then raise exception 'the bought player is still in the roster'; end if;
  select count(*) into v_n from public.roster_players where team_id = v_a and released_at is null;
  if v_n <> 3 then raise exception 'the roster should be back to 3 players, got %', v_n; end if;

  -- the session is scheduled again, extra budget included, snapshot cleared
  perform 1 from public.market_sessions where id = v_s and status = 'scheduled'
    and not extra_budget_applied and opened_at is null;
  if not found then raise exception 'the session was not reset'; end if;
  if exists (select 1 from public.session_free_agents where session_id = v_s) then
    raise exception 'the free-agent snapshot was left behind';
  end if;

  -- and it can be run again from scratch
  perform public.open_market_session(v_s);
  perform 1 from public.teams where id = v_a and credits = 25;
  if not found then raise exception 'reopening did not apply the extra budget again'; end if;

  -- the ledger is immutable again right after the restore
  begin
    delete from public.transactions where team_id = v_a;
    raise exception 'the ledger stayed writable after a restore';
  exception when insufficient_privilege or object_not_in_prerequisite_state then null;
  end;

  perform public.admin_delete_restore_point(v_point);
  if exists (select 1 from public.admin_restore_points() p where p.id = v_point) then
    raise exception 'the point was not deleted';
  end if;
  begin
    perform public.admin_delete_restore_point(v_point);
    raise exception 'deleting a missing point was accepted';
  exception when no_data_found then null;
  end;
  perform auth.test_logout();
  raise notice 'm18 restore points: ok';
end $$;
