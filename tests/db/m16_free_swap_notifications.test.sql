-- M16: admins-only recipients, the email_ops rate-limit bucket and the
-- notifications_free_swap setting that switches the free-swap email off.
do $$
declare
  v_admin uuid; v_admin2 uuid; v_mario uuid;
  v_count int;
begin
  delete from public.profiles; delete from auth.users;
  insert into auth.users (email, raw_user_meta_data) values
    ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values
    ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;
  insert into auth.users (email, raw_user_meta_data) values
    ('anna@example.com', '{"display_name": "Anna", "league_code": "SUPERLEGA-DEV"}') returning id into v_admin2;

  -- a manager sees no recipient at all, with or without the flag
  perform auth.test_login(v_mario, 'authenticated');
  select count(*) into v_count from public.admin_notification_recipients();
  if v_count <> 0 then raise exception 'manager got the recipients'; end if;
  select count(*) into v_count from public.admin_notification_recipients(true);
  if v_count <> 0 then raise exception 'manager got the admin recipients'; end if;
  perform auth.test_logout();

  perform auth.test_login(v_admin, 'authenticated');
  perform public.set_user_role(v_admin2, 'admin');
  -- default: everybody active with an email (session emails keep their behaviour)
  select count(*) into v_count from public.admin_notification_recipients();
  if v_count <> 3 then raise exception 'league recipients changed: %', v_count; end if;
  -- admins only: the free-swap alert
  select count(*) into v_count from public.admin_notification_recipients(true);
  if v_count <> 2 then raise exception 'admins-only recipients wrong: %', v_count; end if;
  perform 1 from public.admin_notification_recipients(true) where email = 'mario@example.com';
  if found then raise exception 'a manager is in the admins-only list'; end if;
  -- an admin who is deactivated stops receiving
  perform public.set_user_active(v_admin2, false);
  select count(*) into v_count from public.admin_notification_recipients(true);
  if v_count <> 1 then raise exception 'inactive admin still a recipient'; end if;
  perform auth.test_logout();

  -- the new setting is a real boolean setting the admin can flip
  perform auth.test_login(v_admin, 'authenticated');
  perform 1 from public.league_settings where key = 'notifications_free_swap' and value = 'true'::jsonb;
  if not found then raise exception 'notifications_free_swap missing or not true by default'; end if;
  perform public.admin_set_setting('notifications_free_swap', 'false'::jsonb);
  perform 1 from public.league_settings where key = 'notifications_free_swap' and value = 'false'::jsonb;
  if not found then raise exception 'notifications_free_swap not saved'; end if;
  begin
    perform public.admin_set_setting('notifications_free_swap', '"no"'::jsonb);
    raise exception 'non-boolean notifications_free_swap accepted';
  exception when invalid_parameter_value then null;
  end;
  perform auth.test_logout();
end $$;

-- email_ops: its own counter, 30 per hour, independent from the league emails
do $$
declare
  v_mario uuid;
  v_i int;
begin
  delete from public.profiles; delete from auth.users;
  delete from private.rate_limits;
  insert into auth.users (email, raw_user_meta_data) values
    ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;
  perform auth.test_login(v_mario, 'authenticated');

  for v_i in 1..30 loop
    perform public.consume_rate_limit('email_ops');
  end loop;
  -- the league bucket is untouched: 5 more league emails are still allowed
  for v_i in 1..5 loop
    perform public.consume_rate_limit('email');
  end loop;
  begin
    perform public.consume_rate_limit('email');
    raise exception 'the email bucket exceeded its 5 per hour';
  exception when program_limit_exceeded then null;
  end;
  -- the 31st free-swap notification of the hour is refused
  begin
    perform public.consume_rate_limit('email_ops');
    raise exception 'the email_ops bucket exceeded its 30 per hour';
  exception when program_limit_exceeded then null;
  end;
  -- an hour later the window reopens
  perform auth.test_logout();
  update private.rate_limits set window_start = now() - interval '2 hours'
  where user_id = v_mario and bucket = 'email_ops';
  perform auth.test_login(v_mario, 'authenticated');
  perform public.consume_rate_limit('email_ops');
  -- unknown buckets are still refused
  begin
    perform public.consume_rate_limit('email_burst');
    raise exception 'unknown bucket accepted';
  exception when invalid_parameter_value then null;
  end;
  perform auth.test_logout();
end $$;
