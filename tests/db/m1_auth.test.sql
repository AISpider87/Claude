-- M1: profiles trigger, bootstrap admin, league code, RLS.
do $$
declare
  v_admin uuid;
  v_manager uuid;
  v_count int;
  v_ok boolean;
begin
  -- signup creates a profile; the bootstrap email becomes admin
  insert into auth.users (email, raw_user_meta_data)
  values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}')
  returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data)
  values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}')
  returning id into v_manager;

  perform 1 from public.profiles where user_id = v_admin and role = 'admin' and display_name = 'Daniele';
  if not found then raise exception 'bootstrap admin not promoted'; end if;
  perform 1 from public.profiles where user_id = v_manager and role = 'manager';
  if not found then raise exception 'manager profile missing'; end if;

  -- display_name falls back to the email local part
  insert into auth.users (email, raw_user_meta_data) values ('luca.rossi@example.com', '{"league_code": "SUPERLEGA-DEV"}');
  perform 1 from public.profiles p join auth.users u on u.id = p.user_id
    where u.email = 'luca.rossi@example.com' and p.display_name = 'luca.rossi';
  if not found then raise exception 'display_name fallback failed'; end if;

  -- league code gate lives in the signup trigger: no code / wrong code = no account
  begin
    insert into auth.users (email, raw_user_meta_data) values ('nocode@example.com', '{"display_name": "X"}');
    raise exception 'signup without league code accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into auth.users (email, raw_user_meta_data) values ('wrong@example.com', '{"league_code": "WRONG"}');
    raise exception 'signup with wrong league code accepted';
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_count from auth.users where email in ('nocode@example.com', 'wrong@example.com');
  if v_count <> 0 then raise exception 'rejected signups left users behind'; end if;

  -- anon cannot reach the league code check nor the settings
  perform auth.test_login(null, 'anon');
  begin
    select private.league_code_matches('SUPERLEGA-DEV') into v_ok;
    raise exception 'anon could call league_code_matches';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.league_settings;
    raise exception 'anon could read league_settings';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.profiles;
    raise exception 'anon could read profiles';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  -- manager: reads all profiles, cannot read league_settings, cannot write profiles
  perform auth.test_login(v_manager, 'authenticated');
  select count(*) into v_count from public.profiles;
  if v_count <> 3 then raise exception 'manager should see 3 profiles, saw %', v_count; end if;
  select count(*) into v_count from public.league_settings;
  if v_count <> 0 then raise exception 'manager could read league_settings'; end if;
  begin
    update public.profiles set role = 'admin' where user_id = v_manager;
    raise exception 'manager could update profiles directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_user_role(v_manager, 'admin');
    raise exception 'manager could promote himself';
  exception when insufficient_privilege then null;
  end;
  perform public.update_my_display_name('  Mario R.  ');
  perform 1 from public.profiles where user_id = v_manager and display_name = 'Mario R.';
  if not found then raise exception 'update_my_display_name failed'; end if;
  perform auth.test_logout();

  -- admin: reads settings, promotes and deactivates, cannot demote/deactivate self
  perform auth.test_login(v_admin, 'authenticated');
  select count(*) into v_count from public.league_settings where key = 'league_code';
  if v_count <> 1 then raise exception 'admin cannot read league_settings'; end if;
  perform public.set_user_role(v_manager, 'admin');
  perform 1 from public.profiles where user_id = v_manager and role = 'admin';
  if not found then raise exception 'promotion failed'; end if;
  perform public.set_user_role(v_manager, 'manager');
  perform public.set_user_active(v_manager, false);
  perform 1 from public.profiles where user_id = v_manager and not is_active;
  if not found then raise exception 'deactivation failed'; end if;
  begin
    perform public.set_user_role(v_admin, 'manager');
    raise exception 'admin could demote himself';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_user_active(v_admin, false);
    raise exception 'admin could deactivate himself';
  exception when invalid_parameter_value then null;
  end;
  perform auth.test_logout();

  -- deactivated manager is no longer a league member (sees only own profile)
  perform auth.test_login(v_manager, 'authenticated');
  select count(*) into v_count from public.profiles;
  if v_count <> 1 then raise exception 'inactive manager should see only own profile, saw %', v_count; end if;
  perform auth.test_logout();
end $$;
