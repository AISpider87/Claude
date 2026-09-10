-- M10: scheduled sessions open and close by themselves via sync_market_sessions().
do $$
declare
  v_admin uuid;
  v_mario uuid;
  v_team uuid;
  v_s1 uuid;
  v_s2 uuid;
  v_res jsonb;
  v_row record;
  v_credits integer;
  v_count integer;
begin
  delete from public.session_free_agents; delete from public.transactions; delete from public.market_sessions;
  delete from public.roster_players; delete from public.teams; delete from public.players;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'Meret', 'Napoli', 'P', 11, 11, 0), (2, 'Dimarco', 'Inter', 'D', 31, 32, -1);
  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  perform auth.test_login(v_admin, 'authenticated');
  v_team := public.admin_upsert_team(null, 'Alpha');
  perform public.admin_set_team_owner(v_team, v_mario);
  perform public.admin_assign_player(v_team, 1, 11);
  select credits into v_credits from public.teams where id = v_team;
  -- s1 is due now, s2 later the same day: only s1 may open
  v_s1 := public.admin_create_session('Prima', now() - interval '1 minute', now() + interval '1 hour', 5);
  v_s2 := public.admin_create_session('Seconda', now() - interval '30 seconds', now() + interval '2 hours', 5);
  perform auth.test_logout();

  -- anonymous callers are rejected
  begin
    perform public.sync_market_sessions();
    raise exception 'anonymous sync accepted';
  exception when insufficient_privilege then null;
  end;

  -- a manager's page load opens the due session
  perform auth.test_login(v_mario, 'authenticated');
  v_res := public.sync_market_sessions();
  if v_res -> 'opened' <> to_jsonb(array[v_s1]) then raise exception 'expected s1 opened, got %', v_res; end if;
  if jsonb_array_length(v_res -> 'closed') <> 0 then raise exception 'nothing should be closed'; end if;
  select * into v_row from public.market_sessions where id = v_s1;
  if v_row.status <> 'open' or v_row.opened_at is null or not v_row.extra_budget_applied then raise exception 's1 not open'; end if;
  perform 1 from public.market_sessions where id = v_s2 and status = 'scheduled';
  if not found then raise exception 's2 must wait'; end if;
  select count(*) into v_count from public.session_free_agents where session_id = v_s1;
  if v_count <> 1 then raise exception 'snapshot should hold the 1 free agent, got %', v_count; end if;
  perform 1 from public.teams where id = v_team and credits = v_credits + 5;
  if not found then raise exception 'extra budget not credited'; end if;
  if (public.current_market_session()).id <> v_s1 then raise exception 'current session should be s1'; end if;

  -- idempotent: a second call changes nothing and credits nothing twice
  v_res := public.sync_market_sessions();
  if jsonb_array_length(v_res -> 'opened') + jsonb_array_length(v_res -> 'closed') <> 0 then raise exception 'second sync should be a no-op'; end if;
  perform 1 from public.teams where id = v_team and credits = v_credits + 5;
  if not found then raise exception 'credits changed on no-op sync'; end if;
  perform auth.test_logout();

  -- when s1 expires, the next load closes it (with report) and opens s2
  perform auth.test_login(v_admin, 'authenticated');
  perform 1 from public.audit_log where action = 'session.open' and entity_id = v_s1::text and payload ->> 'source' = 'auto';
  if not found then raise exception 'auto open not audited'; end if;
  perform auth.test_logout();
  -- superuser: rewind the clock for s1
  update public.market_sessions set closes_at = now() - interval '1 second' where id = v_s1;
  perform auth.test_login(v_mario, 'authenticated');
  v_res := public.sync_market_sessions();
  if v_res -> 'closed' <> to_jsonb(array[v_s1]) or v_res -> 'opened' <> to_jsonb(array[v_s2]) then
    raise exception 'expected s1 closed and s2 opened, got %', v_res;
  end if;
  select * into v_row from public.market_sessions where id = v_s1;
  if v_row.status <> 'closed' or v_row.validation_report is null or (v_row.validation_report ->> 'invalid') is null then
    raise exception 's1 should be closed with a report';
  end if;
  perform 1 from public.teams where id = v_team and credits = v_credits + 10;
  if not found then raise exception 's2 extra budget not credited'; end if;
  perform auth.test_logout();

  -- the service role (cron) can sync, read recipients and log notifications; the
  -- admin functions still refuse plain managers
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_res := public.sync_market_sessions();
  select count(*) into v_count from public.admin_notification_recipients();
  if v_count < 1 then raise exception 'service role should read recipients'; end if;
  perform public.log_notification('session_open', 'test', 1, 'sent', null);
  perform public.consume_rate_limit('email');
  perform set_config('request.jwt.claim.role', '', true);
  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.log_notification('session_open', 'test', 1, 'sent', null);
    raise exception 'manager logged a notification';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.open_market_session(v_s2);
    raise exception 'manager opened a session';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();
end $$;
