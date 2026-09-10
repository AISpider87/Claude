-- M3: team CRUD, owners, manual roster changes, rosters import, non-exclusive ownership, RLS.
do $$
declare
  v_admin uuid;
  v_mario uuid;
  v_luca uuid;
  v_team_a uuid;
  v_team_b uuid;
  v_import uuid;
  v_stats jsonb;
  v_count int;
  v_credits int;
  v_summary jsonb;
begin
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'Meret', 'Napoli', 'P', 11, 11, 0),
    (2, 'Dimarco', 'Inter', 'D', 31, 32, -1),
    (3, 'Paz N.', 'Como', 'C', 30, 30, 0),
    (4, 'Malen', 'Roma', 'A', 37, 34, 3),
    (5, 'Vaz', 'Roma', 'A', 1, 1, 0);
  update public.players set status = 'out_of_list', out_of_list_at = now() where id = 5;

  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;
  insert into auth.users (email, raw_user_meta_data) values ('luca@example.com', '{"display_name": "Luca", "league_code": "SUPERLEGA-DEV"}') returning id into v_luca;

  -- manager cannot manage teams
  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.admin_upsert_team(null, 'Hackers');
    raise exception 'manager created a team';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  -- admin creates teams (short name generated and unique), assigns owners
  perform auth.test_login(v_admin, 'authenticated');
  v_team_a := public.admin_upsert_team(null, 'Real Gear Second');
  v_team_b := public.admin_upsert_team(null, 'Real Madrid FC');
  perform 1 from public.teams where id = v_team_a and short_name = 'REA' and credits = 250;
  if not found then raise exception 'team A short name/credits wrong'; end if;
  perform 1 from public.teams where id = v_team_b and short_name = 'RE2';
  if not found then raise exception 'team B short name not deduplicated'; end if;
  perform public.admin_upsert_team(v_team_b, 'Dream Team', 'DRM', '#ff0000', null);
  perform 1 from public.teams where id = v_team_b and name = 'Dream Team' and short_name = 'DRM' and color_primary = '#ff0000';
  if not found then raise exception 'team update failed'; end if;

  perform public.admin_set_team_owner(v_team_a, v_mario);
  perform public.admin_set_team_owner(v_team_b, v_mario);  -- moves Mario to B
  select count(*) into v_count from public.teams where owner_id = v_mario;
  if v_count <> 1 then raise exception 'one team per manager violated'; end if;
  perform public.admin_set_team_owner(v_team_a, v_mario);
  perform public.admin_set_team_owner(v_team_b, v_luca);

  -- manual assignment: same player in two teams is allowed (non-exclusive ownership)
  perform public.admin_assign_player(v_team_a, 1, 11);
  perform public.admin_assign_player(v_team_b, 1, 11);
  perform public.admin_assign_player(v_team_a, 2, 32);
  select credits into v_credits from public.teams where id = v_team_a;
  if v_credits <> 250 - 11 - 32 then raise exception 'credits after assign wrong: %', v_credits; end if;
  begin
    perform public.admin_assign_player(v_team_a, 1, 11);
    raise exception 'duplicate in same roster allowed';
  exception when unique_violation then null;
  end;
  begin
    perform public.admin_assign_player(v_team_a, 4, 999);
    raise exception 'assignment beyond credits allowed';
  exception when check_violation then null;
  end;
  select count(*) into v_count from public.free_agents;
  if v_count <> 2 then raise exception 'free agents should be Paz and Malen (2), got %', v_count; end if;

  perform public.admin_remove_player(v_team_a, 2, 32);
  select credits into v_credits from public.teams where id = v_team_a;
  if v_credits <> 250 - 11 then raise exception 'credits after remove wrong: %', v_credits; end if;
  begin
    perform public.admin_remove_player(v_team_a, 2, 0);
    raise exception 'removing absent player allowed';
  exception when no_data_found then null;
  end;
  select count(*) into v_count from public.transactions where team_id = v_team_a;
  if v_count <> 3 then raise exception 'expected 3 ledger rows for team A, got %', v_count; end if;

  perform public.admin_set_team_credits(v_team_a, 100, 'test');
  select credits into v_credits from public.teams where id = v_team_a;
  if v_credits <> 100 then raise exception 'set credits failed'; end if;

  -- rosters import: replaces rosters, creates missing teams, resets swaps
  perform auth.test_logout();
  update public.teams set swaps_used = 3 where id = v_team_a;  -- as superuser: direct writes are denied to everyone else
  perform auth.test_login(v_admin, 'authenticated');
  v_import := public.create_rosters_import('rose.xlsx', null, jsonb_build_object('teams', jsonb_build_array(
    jsonb_build_object('name', 'real gear second', 'credits', 0, 'players', jsonb_build_array(
      jsonb_build_object('player_id', 1, 'price_paid', 11),
      jsonb_build_object('player_id', 2, 'price_paid', 32),
      jsonb_build_object('player_id', 5, 'price_paid', 1))),
    jsonb_build_object('name', 'Young Girls', 'credits', 2, 'players', jsonb_build_array(
      jsonb_build_object('player_id', 1, 'price_paid', 11),
      jsonb_build_object('player_id', 4, 'price_paid', 37)))
  )), '{}');
  v_stats := public.apply_rosters_import(v_import);
  if (v_stats ->> 'teams_created')::int <> 1 or (v_stats ->> 'teams_updated')::int <> 1 then
    raise exception 'rosters import team stats wrong: %', v_stats;
  end if;
  if (v_stats ->> 'players_assigned')::int <> 5 or (v_stats ->> 'players_released')::int <> 1 then
    raise exception 'rosters import player stats wrong: %', v_stats;
  end if;
  perform 1 from public.teams where id = v_team_a and credits = 0 and swaps_used = 0 and owner_id = v_mario;
  if not found then raise exception 'team A not updated by import (owner must be kept)'; end if;
  select count(*) into v_count from public.roster_players where team_id = v_team_a and released_at is null;
  if v_count <> 3 then raise exception 'team A roster should have 3 active rows'; end if;
  select count(*) into v_count from public.teams;
  if v_count <> 3 then raise exception 'expected 3 teams'; end if;

  v_summary := public.team_roster_summary(v_team_a);
  if (v_summary ->> 'count')::int <> 3 or (v_summary ->> 'value')::int <> 43
     or (v_summary -> 'by_role' ->> 'P')::int <> 1 or (v_summary ->> 'out_of_list')::int <> 1 then
    raise exception 'roster summary wrong: %', v_summary;
  end if;

  -- unknown player id is rejected and nothing is applied
  v_import := public.create_rosters_import('bad.xlsx', null, jsonb_build_object('teams', jsonb_build_array(
    jsonb_build_object('name', 'Ghost', 'credits', 5, 'players', jsonb_build_array(jsonb_build_object('player_id', 999, 'price_paid', 1)))
  )), '{}');
  begin
    perform public.apply_rosters_import(v_import);
    raise exception 'unknown player accepted';
  exception when no_data_found then null;
  end;
  perform auth.test_logout();

  -- manager reads all teams and rosters, sees own team via owner_id, cannot write
  perform auth.test_login(v_mario, 'authenticated');
  select count(*) into v_count from public.league_teams();
  if v_count <> 3 then raise exception 'manager should list all teams'; end if;
  perform 1 from public.teams where owner_id = auth.uid() and id = v_team_a;
  if not found then raise exception 'manager cannot find own team'; end if;
  -- rosters are private (M12): a manager reads only their own team's rows
  select count(*) into v_count from public.roster_players where released_at is null and team_id = v_team_a;
  if v_count <> 3 then raise exception 'manager should read own 3 roster rows, saw %', v_count; end if;
  perform 1 from public.roster_players where team_id <> v_team_a;
  if found then raise exception 'manager should not read other rosters'; end if;
  begin
    perform public.admin_assign_player(v_team_a, 3, 1);
    raise exception 'manager assigned a player';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.teams set credits = 999 where id = v_team_a;
    raise exception 'manager updated team credits';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();
end $$;
