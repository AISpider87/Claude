-- M15b: availability diagnostics (discovered endpoints + raw samples).
-- Only the service role reads or writes them; the admin sees them through
-- league_settings, which is already admin-only for select.
do $$
declare
  v_admin uuid; v_mario uuid; v_value jsonb; v_big jsonb;
begin
  -- the bootstrap admin email (supabase/seed.sql) is what makes a user an admin
  delete from public.profiles where user_id in (select id from auth.users where email = 'admin@superlega.local');
  delete from auth.users where email = 'admin@superlega.local';
  insert into auth.users (email, raw_user_meta_data)
  values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}')
  returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data)
  values ('mario-diag@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}')
  returning id into v_mario;

  -- ---------------------------------------------------------------------
  -- grants: nobody but the service role
  -- ---------------------------------------------------------------------
  if has_function_privilege('authenticated', 'public.save_availability_diagnostics(text, jsonb, jsonb)', 'execute') then
    raise exception 'authenticated can execute save_availability_diagnostics';
  end if;
  if has_function_privilege('anon', 'public.availability_endpoints()', 'execute') then
    raise exception 'anon can execute availability_endpoints';
  end if;
  if not has_function_privilege('service_role', 'public.availability_endpoints()', 'execute') then
    raise exception 'service_role cannot execute availability_endpoints';
  end if;

  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.save_availability_diagnostics('bsd', '{"injuries": "/x"}'::jsonb, null);
    raise exception 'a manager wrote the availability diagnostics';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  -- ---------------------------------------------------------------------
  -- the service role stores the discovered paths, merged run after run
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.save_availability_diagnostics('bsd', '{"injuries": "/v1/football/injuries"}'::jsonb, null);
  perform public.save_availability_diagnostics('bsd', '{"fixtures": "/v1/football/fixtures"}'::jsonb, null);
  v_value := public.availability_endpoints();
  if v_value ->> 'injuries' is null or v_value ->> 'fixtures' is null then
    raise exception 'endpoints not merged: %', v_value;
  end if;

  -- a run with nothing to say leaves the stored samples alone
  perform public.save_availability_diagnostics('bsd', null,
    '[{"endpoint": "injuries", "url": "https://api.bigballsdata.com/v1/football/injuries", "status": 200, "body": "[]"}]'::jsonb);
  perform public.save_availability_diagnostics('bsd', null, '[]'::jsonb);
  select value into v_value from public.league_settings where key = 'availability_last_samples';
  if jsonb_array_length(v_value -> 'samples') <> 1 then
    raise exception 'samples wiped by a run with nothing to save: %', v_value;
  end if;

  -- an oversized payload is replaced, never stored whole
  select jsonb_agg(jsonb_build_object('endpoint', 'injuries', 'url', '', 'status', 200,
                                      'body', repeat('x', 1000)))
  into v_big from generate_series(1, 20);
  perform public.save_availability_diagnostics('bsd', null, v_big);
  select value into v_value from public.league_settings where key = 'availability_last_samples';
  if length(v_value::text) > 9000 then
    raise exception 'oversized samples stored whole: % chars', length(v_value::text);
  end if;
  perform set_config('request.jwt.claim.role', '', true);

  -- ---------------------------------------------------------------------
  -- a manager cannot read the settings rows, an admin can
  -- ---------------------------------------------------------------------
  perform auth.test_login(v_mario, 'authenticated');
  if exists (select 1 from public.league_settings where key = 'availability_last_samples') then
    raise exception 'a manager read the availability samples';
  end if;
  perform auth.test_logout();

  perform auth.test_login(v_admin, 'authenticated');
  if not exists (select 1 from public.league_settings where key = 'availability_last_samples') then
    raise exception 'the admin cannot read the availability samples';
  end if;
  perform auth.test_logout();
end $$;
