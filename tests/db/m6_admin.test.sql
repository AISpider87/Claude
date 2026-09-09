-- M6: emails visible only to admins, user directory, recipients, audit reader, notifications log.
do $$
declare
  v_admin uuid; v_mario uuid;
  v_count int;
  v_email text;
begin
  delete from public.profiles; delete from auth.users;
  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  -- email copied at signup and kept in sync
  perform 1 from public.profiles where user_id = v_mario and email = 'mario@example.com';
  if not found then raise exception 'email not copied at signup'; end if;
  update auth.users set email = 'mario.new@example.com' where id = v_mario;
  perform 1 from public.profiles where user_id = v_mario and email = 'mario.new@example.com';
  if not found then raise exception 'email not synced on change'; end if;

  -- manager: directory without emails, no admin readers
  perform auth.test_login(v_mario, 'authenticated');
  select count(*) into v_count from public.profiles;
  if v_count <> 2 then raise exception 'manager should read the directory'; end if;
  begin
    select email into v_email from public.profiles where user_id = v_mario;
    raise exception 'manager could read emails';
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_count from public.admin_list_users();
  if v_count <> 0 then raise exception 'manager got the user list'; end if;
  select count(*) into v_count from public.admin_notification_recipients();
  if v_count <> 0 then raise exception 'manager got recipients'; end if;
  select count(*) into v_count from public.admin_audit_log(10);
  if v_count <> 0 then raise exception 'manager read the audit log'; end if;
  begin
    perform public.log_notification('test', 'x', 0, 'sent', null);
    raise exception 'manager logged a notification';
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_count from public.notifications;
  if v_count <> 0 then raise exception 'manager read notifications'; end if;
  perform auth.test_logout();

  -- admin: everything
  perform auth.test_login(v_admin, 'authenticated');
  select count(*) into v_count from public.admin_list_users() where email is not null;
  if v_count <> 2 then raise exception 'admin list without emails'; end if;
  perform public.set_user_active(v_mario, false);
  select count(*) into v_count from public.admin_notification_recipients();
  if v_count <> 1 then raise exception 'inactive user still a recipient'; end if;
  select count(*) into v_count from public.admin_audit_log(10);
  if v_count < 1 then raise exception 'audit reader empty'; end if;
  perform public.log_notification('session_open', 'Sessione aperta', 19, 'sent', null);
  select count(*) into v_count from public.notifications where status = 'sent';
  if v_count <> 1 then raise exception 'notification not logged'; end if;
  perform auth.test_logout();
end $$;

-- M6 (QA findings): no admin roster edits or roster imports while a session is open,
-- settings validated by key, unique team short names.
do $$
declare
  v_admin uuid; v_team uuid; v_other uuid; v_session uuid; v_import uuid;
begin
  delete from public.profiles; delete from auth.users;
  delete from public.session_free_agents; delete from public.transactions; delete from public.market_sessions;
  delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'Meret', 'Napoli', 'P', 11, 11, 0),
    (2, 'Dimarco', 'Inter', 'D', 31, 32, -1);
  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  perform auth.test_login(v_admin, 'authenticated');

  v_team := public.admin_upsert_team(null, 'Guard FC', 'GRD', null, null);
  perform public.admin_assign_player(v_team, 1, 10, null);

  -- duplicate short name refused
  begin
    v_other := public.admin_upsert_team(null, 'Altra squadra', 'GRD', null, null);
    raise exception 'duplicate short name accepted';
  exception when unique_violation then null;
  end;

  v_session := public.admin_create_session('Guard session', now(), now() + interval '1 day', 0);
  perform public.open_market_session(v_session);

  begin
    perform public.admin_assign_player(v_team, 2, 10, null);
    raise exception 'admin_assign_player allowed during an open session';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.admin_remove_player(v_team, 1, 0, null);
    raise exception 'admin_remove_player allowed during an open session';
  exception when object_not_in_prerequisite_state then null;
  end;
  v_import := public.create_rosters_import('rose.xlsx', null,
    '{"teams": [{"name": "Guard FC", "credits": 240, "players": [{"player_id": 2, "price_paid": 10}]}]}'::jsonb,
    '{}'::jsonb);
  begin
    perform public.apply_rosters_import(v_import);
    raise exception 'apply_rosters_import allowed during an open session';
  exception when object_not_in_prerequisite_state then null;
  end;

  perform public.close_market_session(v_session);
  perform public.admin_assign_player(v_team, 2, 10, null);  -- allowed again

  -- settings validation
  begin
    perform public.admin_set_setting('roster_composition', '"3/7/7/6"'::jsonb);
    raise exception 'malformed composition accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_setting('season_swap_limit', '"venti"'::jsonb);
    raise exception 'non-numeric limit accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_setting('league_code', '"abc"'::jsonb);
    raise exception 'short league code accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_setting('league_code', '"  abc  "'::jsonb);
    raise exception 'padded short league code accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_setting('league_code', '"codice lega"'::jsonb);
    raise exception 'league code with spaces accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_setting('bootstrap_admin_email', '"altro@example.com"'::jsonb);
    raise exception 'bootstrap admin email changed while an admin exists';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_setting('made_up_key', '1'::jsonb);
    raise exception 'unknown setting accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.admin_set_setting('roster_composition', '{"P": 3, "D": 7, "C": 7, "A": 6}'::jsonb);
  perform public.admin_set_setting('season_swap_limit', '20'::jsonb);
  perform public.admin_set_setting('league_code', '"nuovo-codice"'::jsonb);
  if (select value #>> '{}' from public.league_settings where key = 'league_code') <> 'NUOVO-CODICE' then
    raise exception 'league code not normalised';
  end if;
  perform auth.test_logout();
end $$;
