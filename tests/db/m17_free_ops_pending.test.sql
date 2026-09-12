-- M17: a free swap made inside an open session is pending like the others —
-- it shows up among the session's operations and the manager can undo it —
-- while outside a session it stays immediate. It never counts toward the 20.
do $$
declare
  v_admin uuid; v_mario uuid;
  v_a uuid; v_s uuid;
  v_rel uuid; v_buy uuid; v_state jsonb;
begin
  alter table public.transactions disable trigger trg_transactions_guard;
  delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  alter table public.transactions enable trigger trg_transactions_guard;
  insert into public.league_settings (key, value) values ('roster_composition', '{"P":1,"D":2,"C":0,"A":0}')
  on conflict (key) do update set value = excluded.value;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff, status) values
    (1, 'Por1', 'Roma', 'P', 10, 10, 0, 'active'),
    (2, 'Def1', 'Roma', 'D', 6, 6, 0, 'active'),
    (3, 'Gone', 'Estero', 'D', 8, 8, 0, 'out_of_list'),
    (4, 'Woltemade', 'Como', 'D', 12, 12, 0, 'active'),
    (5, 'Def4', 'Pisa', 'D', 4, 4, 0, 'active');
  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  perform auth.test_login(v_admin, 'authenticated');
  v_a := public.admin_upsert_team(null, 'Alpha');
  perform public.admin_set_team_owner(v_a, v_mario);
  perform public.admin_assign_player(v_a, 1, 10);
  perform public.admin_assign_player(v_a, 2, 6);
  perform public.admin_assign_player(v_a, 3, 8);   -- out of list, paid 8
  perform public.admin_set_team_credits(v_a, 20, 'test');
  v_s := public.admin_create_session('Uno', now() - interval '1 minute', now() + interval '1 hour', 0);
  perform public.open_market_session(v_s);
  perform auth.test_logout();

  perform auth.test_login(v_mario, 'authenticated');
  -- free release inside the session: pending, refund paid, no swap counted
  v_rel := public.release_out_of_list(v_a, 3);
  perform 1 from public.transactions where id = v_rel and status = 'pending' and not counts_toward_limit;
  if not found then raise exception 'a free release inside a session must be pending'; end if;
  perform 1 from public.teams where id = v_a and credits = 28 and swaps_used = 0;
  if not found then raise exception 'free release did not refund the price paid'; end if;

  -- the free purchase that fills its slot: pending too, still not counting
  v_buy := public.buy_player(v_a, 4);
  perform 1 from public.transactions where id = v_buy and status = 'pending' and not counts_toward_limit;
  if not found then raise exception 'the free purchase must be pending as well'; end if;
  v_state := public.team_market_state(v_a);
  if (v_state #>> '{pending,operations}')::int <> 2 or (v_state #>> '{pending,swaps}')::int <> 0 then
    raise exception 'a free pair must show as 2 pending operations and 0 counting swaps: %', v_state;
  end if;

  -- both can be undone, newest first (the seat must be free again for the release)
  perform public.undo_pending_operation(v_buy);
  perform 1 from public.teams where id = v_a and credits = 28;
  if not found then raise exception 'undo of the free purchase wrong'; end if;
  perform public.undo_pending_operation(v_rel);
  perform 1 from public.teams where id = v_a and credits = 20;
  if not found then raise exception 'undo of the free release did not take the refund back'; end if;
  perform 1 from public.roster_players where team_id = v_a and player_id = 3 and released_at is null and price_paid = 8;
  if not found then raise exception 'undone free release did not restore the player'; end if;

  -- undoing a free release whose seat has been refilled is refused (H1)
  v_rel := public.release_out_of_list(v_a, 3);
  perform public.buy_player(v_a, 4);
  begin
    perform public.undo_pending_operation(v_rel);
    raise exception 'undo of a refilled free release accepted';
  exception when invalid_parameter_value then null;
  end;

  -- at the closing the free pair becomes final, still without counting
  perform auth.test_logout();
  perform auth.test_login(v_admin, 'authenticated');
  perform public.close_market_session(v_s);
  perform 1 from public.teams where id = v_a and swaps_used = 0;
  if not found then raise exception 'a confirmed free pair must not count toward the 20'; end if;
  if exists (select 1 from public.transactions where team_id = v_a and status = 'pending') then
    raise exception 'closing left pending operations behind';
  end if;

  -- outside a session the free release is immediate: nothing would confirm it
  perform auth.test_logout();
  update public.players set status = 'out_of_list' where id = 4;
  perform auth.test_login(v_mario, 'authenticated');
  v_rel := public.release_out_of_list(v_a, 4);
  perform 1 from public.transactions where id = v_rel and status = 'confirmed' and session_id is null;
  if not found then raise exception 'outside a session a free release must be final at once'; end if;
  begin
    perform public.undo_pending_operation(v_rel);
    raise exception 'a confirmed free release was undone';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform auth.test_logout();
  raise notice 'm17 free ops pending: ok';
end $$;
