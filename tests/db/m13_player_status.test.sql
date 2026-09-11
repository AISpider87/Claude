-- M13: player availability set by the admin, readable by the league.
do $$
declare
  v_admin uuid; v_mario uuid; v_row record;
begin
  delete from public.player_status; delete from public.roster_players; delete from public.teams; delete from public.players;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values (1, 'Meret', 'Napoli', 'P', 11, 11, 0);
  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.admin_set_player_status(1, 'injured', 'x', null, null);
    raise exception 'manager set a status';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  perform auth.test_login(v_admin, 'authenticated');
  begin
    perform public.admin_set_player_status(1, 'broken', null, null, null);
    raise exception 'invalid kind accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_player_status(1, 'injured', null, 'x', 'javascript:alert(1)');
    raise exception 'non-http source url accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.admin_set_player_status(999, 'injured', null, null, null);
    raise exception 'unknown player accepted';
  exception when no_data_found then null;
  end;
  perform public.admin_set_player_status(1, 'injured', ' Lesione muscolare, rientro a ottobre ', ' Fantacalcio.it ', 'https://www.fantacalcio.it/indisponibili-serie-a');
  select * into v_row from public.player_status where player_id = 1;
  if v_row.kind <> 'injured' or v_row.note <> 'Lesione muscolare, rientro a ottobre' or v_row.source_name <> 'Fantacalcio.it' or v_row.updated_by <> v_admin then
    raise exception 'status row wrong: %', v_row;
  end if;
  perform public.admin_set_player_status(1, 'doubtful', null, null, null);
  perform 1 from public.player_status where player_id = 1 and kind = 'doubtful' and note is null;
  if not found then raise exception 'status not updated'; end if;
  perform auth.test_logout();

  -- members read it; "ok" clears it
  perform auth.test_login(v_mario, 'authenticated');
  perform 1 from public.player_status where player_id = 1;
  if not found then raise exception 'member cannot read the status'; end if;
  perform auth.test_logout();
  perform auth.test_login(v_admin, 'authenticated');
  perform public.admin_set_player_status(1, 'ok', null, null, null);
  perform 1 from public.player_status where player_id = 1;
  if found then raise exception 'ok did not clear the status'; end if;
  perform auth.test_logout();
end $$;
