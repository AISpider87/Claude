-- M12: rosters, budgets and operations are private to the manager; the admin sees all.
do $$
declare
  v_admin uuid; v_mario uuid; v_luca uuid;
  v_a uuid; v_b uuid;
  v_count int;
begin
  alter table public.transactions disable trigger trg_transactions_guard;
  delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  alter table public.transactions enable trigger trg_transactions_guard;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'Por1', 'Roma', 'P', 10, 10, 0), (2, 'Por2', 'Inter', 'P', 15, 15, 0), (3, 'Por3', 'Como', 'P', 5, 5, 0);
  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;
  insert into auth.users (email, raw_user_meta_data) values ('luca@example.com', '{"display_name": "Luca", "league_code": "SUPERLEGA-DEV"}') returning id into v_luca;

  perform auth.test_login(v_admin, 'authenticated');
  v_a := public.admin_upsert_team(null, 'Alpha');
  v_b := public.admin_upsert_team(null, 'Beta');
  perform public.admin_set_team_owner(v_a, v_mario);
  perform public.admin_set_team_owner(v_b, v_luca);
  perform public.admin_assign_player(v_a, 1, 10);
  perform public.admin_assign_player(v_b, 2, 15);
  -- admin sees everything
  select count(*) into v_count from public.roster_players where released_at is null;
  if v_count <> 2 then raise exception 'admin should see both rosters'; end if;
  select count(*) into v_count from public.teams;
  if v_count <> 2 then raise exception 'admin should see both team rows'; end if;
  select count(*) into v_count from public.transactions;
  if v_count <> 2 then raise exception 'admin should see both operations'; end if;
  perform auth.test_logout();

  perform auth.test_login(v_mario, 'authenticated');
  -- the league list shows every team (names, colours, managers); the table only one's own
  select count(*) into v_count from public.league_teams();
  if v_count <> 2 then raise exception 'manager should list all teams via league_teams'; end if;
  perform 1 from public.league_teams() where id = v_b and owner_name = 'Luca';
  if not found then raise exception 'league_teams should name the manager'; end if;
  select count(*) into v_count from public.teams;
  if v_count <> 1 then raise exception 'manager should read only their own team row, saw %', v_count; end if;
  perform 1 from public.teams where id = v_a and credits >= 0;
  if not found then raise exception 'manager should read their own credits'; end if;
  -- rosters and operations: own team only
  select count(*) into v_count from public.roster_players where released_at is null;
  if v_count <> 1 then raise exception 'manager should see only their roster rows, saw %', v_count; end if;
  perform 1 from public.roster_players where team_id = v_b;
  if found then raise exception 'manager saw another roster'; end if;
  select count(*) into v_count from public.transactions;
  if v_count <> 1 then raise exception 'manager should see only their operations, saw %', v_count; end if;
  -- free agents are still computed over every roster: Por2 (owned by Beta) is not free
  perform 1 from public.free_agents where id = 2;
  if found then raise exception 'free_agents leaked a player owned by another team'; end if;
  perform 1 from public.free_agents where id = 3;
  if not found then raise exception 'free_agents should list the unowned player'; end if;
  -- market state of another team is hidden
  if public.team_market_state(v_b) is not null then raise exception 'market state of another team leaked'; end if;
  if public.team_market_state(v_a) is null then raise exception 'own market state should be visible'; end if;
  perform auth.test_logout();
end $$;
