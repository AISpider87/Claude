-- M9: rosters import with out-of-list placeholders (players who left Serie A) and
-- their free release.
do $$
declare
  v_admin uuid;
  v_mario uuid;
  v_team uuid;
  v_import uuid;
  v_stats jsonb;
  v_placeholder integer;
  v_again integer;
  v_credits integer;
  v_tx uuid;
  v_row record;
begin
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'Meret', 'Napoli', 'P', 11, 11, 0),
    (2, 'Dimarco', 'Inter', 'D', 31, 32, -1),
    (3, 'Bastoni', 'Inter', 'D', 20, 20, 0);

  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  perform auth.test_login(v_admin, 'authenticated');

  -- placeholder role is validated
  v_import := public.create_rosters_import('rose.xlsx', null, jsonb_build_object('teams', jsonb_build_array(
    jsonb_build_object('name', 'Alpha', 'credits', 200, 'players', jsonb_build_array(
      jsonb_build_object('placeholder', jsonb_build_object('name', 'Partito', 'role', 'X'), 'price_paid', 9))))), '{}'::jsonb);
  begin
    perform public.apply_rosters_import(v_import);
    raise exception 'placeholder with invalid role accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.fail_import(v_import, 'test');

  -- placeholder gets a negative id, out_of_list status, and joins the roster
  v_import := public.create_rosters_import('rose.xlsx', null, jsonb_build_object('teams', jsonb_build_array(
    jsonb_build_object('name', 'Alpha', 'credits', 200, 'players', jsonb_build_array(
      jsonb_build_object('player_id', 1, 'price_paid', 11),
      jsonb_build_object('placeholder', jsonb_build_object('name', 'Partito', 'role', 'D'), 'price_paid', 9))))), '{}'::jsonb);
  v_stats := public.apply_rosters_import(v_import);
  if (v_stats ->> 'placeholders')::int <> 1 then raise exception 'placeholders stat = %', v_stats ->> 'placeholders'; end if;
  if (v_stats ->> 'players_assigned')::int <> 2 then raise exception 'players_assigned = %', v_stats ->> 'players_assigned'; end if;

  select id into v_team from public.teams where name = 'Alpha';
  select p.id into v_placeholder from public.players p where p.name = 'Partito';
  if v_placeholder is null or v_placeholder >= 0 then raise exception 'placeholder id should be negative, got %', v_placeholder; end if;
  select * into v_row from public.players where id = v_placeholder;
  if v_row.status <> 'out_of_list' or v_row.role_classic <> 'D' or v_row.out_of_list_at is null then
    raise exception 'placeholder should be out_of_list D';
  end if;
  perform 1 from public.roster_players where team_id = v_team and player_id = v_placeholder and released_at is null and price_paid = 9;
  if not found then raise exception 'placeholder not in roster'; end if;
  if (public.team_roster_summary(v_team) ->> 'out_of_list')::int <> 1 then raise exception 'summary should count 1 out of list'; end if;
  perform 1 from public.free_agents where id = v_placeholder;
  if found then raise exception 'placeholder must never be a free agent'; end if;

  -- re-importing the same file reuses the placeholder instead of creating a twin
  v_import := public.create_rosters_import('rose.xlsx', null, jsonb_build_object('teams', jsonb_build_array(
    jsonb_build_object('name', 'Alpha', 'credits', 200, 'players', jsonb_build_array(
      jsonb_build_object('player_id', 1, 'price_paid', 11),
      jsonb_build_object('placeholder', jsonb_build_object('name', 'partito', 'role', 'D'), 'price_paid', 9))))), '{}'::jsonb);
  perform public.apply_rosters_import(v_import);
  select count(*) into v_again from public.players where lower(name) = 'partito';
  if v_again <> 1 then raise exception 'expected one placeholder, found %', v_again; end if;

  -- a quotations import never touches the placeholder (negative ids are not in any file)
  v_import := public.create_quotations_import('manual', 'q.xlsx', null,
    jsonb_build_object('rows', jsonb_build_array(
      jsonb_build_object('id', 1, 'name', 'Meret', 'team', 'Napoli', 'role_classic', 'P', 'qt_a', 12, 'qt_i', 11, 'diff', 1),
      jsonb_build_object('id', 2, 'name', 'Dimarco', 'team', 'Inter', 'role_classic', 'D', 'qt_a', 30, 'qt_i', 32, 'diff', -2),
      jsonb_build_object('id', 3, 'name', 'Bastoni', 'team', 'Inter', 'role_classic', 'D', 'qt_a', 20, 'qt_i', 20, 'diff', 0)),
      'out_of_list_ids', '[]'::jsonb), '{}'::jsonb);
  perform public.apply_quotations_import(v_import);
  select * into v_row from public.players where id = v_placeholder;
  if v_row.status <> 'out_of_list' or v_row.name <> 'Partito' then raise exception 'placeholder altered by quotations import'; end if;

  -- the manager releases the placeholder for free: refund = price paid, cost = Qt.A of the new player
  perform public.admin_set_team_owner(v_team, v_mario);
  perform auth.test_logout();
  perform auth.test_login(v_mario, 'authenticated');
  select credits into v_credits from public.teams where id = v_team;
  v_tx := public.free_swap_player(v_team, v_placeholder, 3);
  perform 1 from public.transactions where id = v_tx and kind = 'free_swap' and player_out_price = 9 and player_in_price = 20 and counts_toward_limit = false;
  if not found then raise exception 'free swap of placeholder not recorded as expected'; end if;
  perform 1 from public.teams where id = v_team and credits = v_credits + 9 - 20 and swaps_used = 0;
  if not found then raise exception 'credits after free swap wrong'; end if;
  perform 1 from public.roster_players where team_id = v_team and player_id = v_placeholder and released_at is null;
  if found then raise exception 'placeholder still in roster'; end if;
  perform auth.test_logout();
end $$;
