-- QA review M4: gaps found against SPEC §3 / market-rules. Each block fails until the rule is enforced.
--
-- Gap A: a player who is out_of_list must leave the roster only through free_swap_player
-- (SPEC §3 "la sostituzione è un cambio gratuito"; rimborso = prezzo pagato). swap_player
-- currently accepts him: refund = Qt.A (can exceed the price paid) and a season swap is burned.
do $$
declare
  v_admin uuid; v_mario uuid; v_a uuid; v_s1 uuid;
  v_credits int; v_swaps int;
begin
  alter table public.transactions disable trigger trg_transactions_immutable;
  delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  delete from public.profiles; delete from auth.users;
  alter table public.transactions enable trigger trg_transactions_immutable;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (5, 'Att2', 'Inter', 'A', 20, 20, 0), (7, 'Gone', 'Estero', 'A', 25, 25, 0);
  update public.players set status = 'out_of_list', out_of_list_at = now() where id = 7;
  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  perform auth.test_login(v_admin, 'authenticated');
  v_a := public.admin_upsert_team(null, 'Alpha');
  perform public.admin_set_team_owner(v_a, v_mario);
  perform public.admin_assign_player(v_a, 7, 8);        -- Gone bought at 8, now out of list with Qt.A 25
  perform public.admin_set_team_credits(v_a, 20, 'qa');
  v_s1 := public.admin_create_session('Sessione QA', now(), now() + interval '1 day', 0);
  perform public.open_market_session(v_s1);
  perform auth.test_logout();

  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.swap_player(v_a, 7, 5);              -- direct RPC: the UI hides out-of-list players here
    raise exception 'swap_player accepted an out_of_list player_out (refund at Qt.A instead of price paid, swap counted)';
  exception when invalid_parameter_value then null;     -- expected: a dedicated NOT_ALLOWED/OUT_OF_LIST error
  end;
  select credits, swaps_used into v_credits, v_swaps from public.teams where id = v_a;
  if v_credits <> 20 or v_swaps <> 0 then raise exception 'state changed: credits % swaps %', v_credits, v_swaps; end if;
  perform auth.test_logout();
end $$;
