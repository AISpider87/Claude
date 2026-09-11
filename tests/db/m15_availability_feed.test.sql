-- M15: automatic availability/lineup feed. Only the service role writes it,
-- the admin's manual rows survive it, and rows the feed stops reporting go away.
do $$
declare
  v_admin uuid; v_mario uuid; v_row record; v_res jsonb; v_count integer; v_claim boolean;
begin
  delete from public.player_lineup_status;
  delete from public.external_player_map;
  delete from public.player_status;
  delete from public.roster_players; delete from public.teams; delete from public.players;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
    (1, 'Meret', 'Napoli', 'P', 11, 11, 0),
    (2, 'Bastoni', 'Inter', 'D', 18, 18, 0),
    (3, 'Barella', 'Inter', 'C', 22, 22, 0);
  insert into auth.users (email, raw_user_meta_data) values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data) values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_mario;

  -- ---------------------------------------------------------------------
  -- only the service role may write the feed
  -- ---------------------------------------------------------------------
  if has_function_privilege('authenticated', 'public.sync_availability(jsonb)', 'execute') then
    raise exception 'authenticated can execute sync_availability';
  end if;
  if has_function_privilege('anon', 'public.sync_availability(jsonb)', 'execute') then
    raise exception 'anon can execute sync_availability';
  end if;
  if not has_function_privilege('service_role', 'public.sync_availability(jsonb)', 'execute') then
    raise exception 'service_role cannot execute sync_availability';
  end if;

  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.sync_availability('{"statuses": []}'::jsonb);
    raise exception 'a manager wrote the availability feed';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  -- an authenticated session without the service-role claim is refused as well
  begin
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform public.sync_availability('{"statuses": []}'::jsonb);
    raise exception 'an admin session wrote the availability feed';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', '', true);

  -- ---------------------------------------------------------------------
  -- a manual row is never overwritten by the feed
  -- ---------------------------------------------------------------------
  perform auth.test_login(v_admin, 'authenticated');
  perform public.admin_set_player_status(1, 'injured', 'lesione, rientro a ottobre', 'Fantacalcio.it', 'https://www.fantacalcio.it/x');
  perform auth.test_logout();
  select * into v_row from public.player_status where player_id = 1;
  if v_row.origin <> 'manual' then raise exception 'admin row is not manual: %', v_row; end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_res := public.sync_availability(jsonb_build_object(
    'provider', 'api-football',
    'clear_missing', true,
    'statuses', jsonb_build_array(
      jsonb_build_object('player_id', 1, 'kind', 'doubtful', 'note', 'Questionable', 'source_name', 'API-Football', 'source_url', 'https://www.api-football.com/'),
      jsonb_build_object('player_id', 2, 'kind', 'suspended', 'note', 'Suspended', 'source_name', 'API-Football', 'source_url', 'https://www.api-football.com/'),
      jsonb_build_object('player_id', 3, 'kind', 'injured', 'note', 'Knee Injury', 'source_name', 'API-Football', 'source_url', 'https://www.api-football.com/'),
      jsonb_build_object('player_id', 999, 'kind', 'injured'),
      jsonb_build_object('player_id', 3, 'kind', 'nonsense')
    ),
    'lineups', jsonb_build_array(
      jsonb_build_object('player_id', 2, 'state', 'starting', 'fixture_id', 1208002, 'kickoff', now() + interval '1 hour'),
      jsonb_build_object('player_id', 3, 'state', 'bench', 'fixture_id', 1208002, 'kickoff', now() + interval '1 hour'),
      jsonb_build_object('player_id', 999, 'state', 'starting', 'fixture_id', 1208002, 'kickoff', now())
    ),
    'map', jsonb_build_array(
      jsonb_build_object('external_id', 2867, 'player_id', 2, 'external_name', 'Alessandro Bastoni'),
      jsonb_build_object('external_id', 1100, 'player_id', 3, 'external_name', 'Nicolo Barella')
    ),
    'run', jsonb_build_object('status', 'ok', 'requests', 3)
  ));

  select * into v_row from public.player_status where player_id = 1;
  if v_row.origin <> 'manual' or v_row.kind <> 'injured' or v_row.source_name <> 'Fantacalcio.it' then
    raise exception 'the feed overwrote the admin row: %', v_row;
  end if;
  if (v_res ->> 'statuses_kept_manual')::int <> 1 then
    raise exception 'manual rows not reported: %', v_res;
  end if;
  if (v_res ->> 'statuses_applied')::int <> 2 then
    raise exception 'wrong number of feed statuses: %', v_res;
  end if;
  -- unknown players and unknown kinds are dropped, not an error
  if exists (select 1 from public.player_status where player_id = 999) then
    raise exception 'unknown player got a status';
  end if;
  select count(*) into v_count from public.player_status where origin = 'feed';
  if v_count <> 2 then raise exception 'expected 2 feed rows, got %', v_count; end if;
  select * into v_row from public.player_status where player_id = 2;
  if v_row.kind <> 'suspended' or v_row.origin <> 'feed' or v_row.source_url <> 'https://www.api-football.com/' then
    raise exception 'feed row wrong: %', v_row;
  end if;

  -- lineups: only known players, the state as given
  select count(*) into v_count from public.player_lineup_status;
  if v_count <> 2 then raise exception 'expected 2 lineup rows, got %', v_count; end if;
  select * into v_row from public.player_lineup_status where player_id = 3;
  if v_row.state <> 'bench' or v_row.fixture_id <> 1208002 then
    raise exception 'lineup row wrong: %', v_row;
  end if;

  select count(*) into v_count from public.external_player_map where provider = 'api-football';
  if v_count <> 2 then raise exception 'expected 2 mappings, got %', v_count; end if;

  -- ---------------------------------------------------------------------
  -- second run: what the feed stops reporting disappears, manual rows stay,
  -- and the lineups of the same fixture are replaced
  -- ---------------------------------------------------------------------
  v_res := public.sync_availability(jsonb_build_object(
    'clear_missing', true,
    'statuses', jsonb_build_array(
      jsonb_build_object('player_id', 2, 'kind', 'injured', 'note', 'Hamstring Injury', 'source_name', 'API-Football')
    ),
    'lineups', jsonb_build_array(
      jsonb_build_object('player_id', 3, 'state', 'starting', 'fixture_id', 1208002, 'kickoff', now() + interval '1 hour')
    )
  ));
  if (v_res ->> 'statuses_cleared')::int <> 1 then
    raise exception 'the missing feed row was not cleared: %', v_res;
  end if;
  if exists (select 1 from public.player_status where player_id = 3) then
    raise exception 'player 3 kept a status the feed no longer reports';
  end if;
  if not exists (select 1 from public.player_status where player_id = 1 and origin = 'manual') then
    raise exception 'clear_missing deleted the admin row';
  end if;
  select * into v_row from public.player_status where player_id = 2;
  if v_row.kind <> 'injured' or v_row.note <> 'Hamstring Injury' then
    raise exception 'feed row not updated: %', v_row;
  end if;
  select count(*) into v_count from public.player_lineup_status;
  if v_count <> 1 then raise exception 'lineups not replaced, got % rows', v_count; end if;
  select * into v_row from public.player_lineup_status where player_id = 3;
  if v_row.state <> 'starting' then raise exception 'lineup state not replaced: %', v_row; end if;

  -- the run is recorded for the admin panel
  if not exists (select 1 from public.league_settings where key = 'availability_synced_at') then
    raise exception 'availability_synced_at not written';
  end if;
  if not exists (select 1 from public.audit_log where action = 'availability.feed') then
    raise exception 'the feed run was not audited';
  end if;

  -- ---------------------------------------------------------------------
  -- the staleness guard lets exactly one caller through per window
  -- ---------------------------------------------------------------------
  delete from public.league_settings where key = 'availability_refresh_claimed_at';
  v_claim := public.claim_availability_refresh(900);
  if not v_claim then raise exception 'the first caller did not get the claim'; end if;
  v_claim := public.claim_availability_refresh(900);
  if v_claim then raise exception 'two callers got the same claim'; end if;
  perform set_config('request.jwt.claim.role', '', true);

  -- ---------------------------------------------------------------------
  -- admin_confirm_player_map: admin only, and it wins over the feed's guess
  -- ---------------------------------------------------------------------
  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.admin_confirm_player_map(2, 'api-football', 2867, 'Alessandro Bastoni');
    raise exception 'a manager confirmed a mapping';
  exception when insufficient_privilege then null;
  end;
  -- a manager cannot even read the mapping table
  select count(*) into v_count from public.external_player_map;
  if v_count <> 0 then raise exception 'a manager read the mapping table'; end if;
  perform auth.test_logout();

  perform auth.test_login(v_admin, 'authenticated');
  begin
    perform public.admin_confirm_player_map(999, 'api-football', 1, 'x');
    raise exception 'unknown player accepted';
  exception when no_data_found then null;
  end;
  perform public.admin_confirm_player_map(1, 'api-football', 3000, 'Lautaro Martinez');
  select * into v_row from public.external_player_map where provider = 'api-football' and external_id = 3000;
  if v_row.player_id <> 1 or v_row.confidence <> 'confirmed' then
    raise exception 'confirmed mapping wrong: %', v_row;
  end if;
  -- one provider id per listone player: rebinding moves it, never duplicates
  perform public.admin_confirm_player_map(1, 'api-football', 3001, 'Lautaro Martinez');
  select count(*) into v_count from public.external_player_map where provider = 'api-football' and player_id = 1;
  if v_count <> 1 then raise exception 'rebinding left % rows', v_count; end if;
  select count(*) into v_count from public.admin_external_map('api-football');
  if v_count < 1 then raise exception 'admin cannot read the mapping'; end if;
  perform auth.test_logout();

  -- ---------------------------------------------------------------------
  -- a confirmed mapping is not downgraded by the next automatic run
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.sync_availability(jsonb_build_object(
    'map', jsonb_build_array(jsonb_build_object('external_id', 3001, 'player_id', 2, 'external_name', 'qualcun altro'))
  ));
  select * into v_row from public.external_player_map where provider = 'api-football' and external_id = 3001;
  if v_row.player_id <> 1 or v_row.confidence <> 'confirmed' then
    raise exception 'the feed overwrote a confirmed mapping: %', v_row;
  end if;
  perform set_config('request.jwt.claim.role', '', true);

  -- ---------------------------------------------------------------------
  -- league members read the lineups; anon does not
  -- ---------------------------------------------------------------------
  perform auth.test_login(v_mario, 'authenticated');
  select count(*) into v_count from public.player_lineup_status;
  if v_count <> 1 then raise exception 'a member cannot read the lineups'; end if;
  perform auth.test_logout();
  perform auth.test_login(null, 'anon');
  begin
    select count(*) into v_count from public.player_lineup_status;
    if v_count <> 0 then raise exception 'anon read the lineups'; end if;
  exception when insufficient_privilege then null; -- no grant at all is even better
  end;
  perform auth.test_logout();
end $$;

-- the scheduler token: admin reads and rotates it, the service role verifies it,
-- managers can do neither (the token never reaches league_settings readers).
do $$
declare
  v_admin uuid; v_mario uuid; v_token text; v_rotated text;
begin
  select user_id into v_admin from public.profiles where role = 'admin' limit 1;
  select user_id into v_mario from public.profiles where role = 'manager' limit 1;

  perform auth.test_login(v_mario, 'authenticated');
  begin
    perform public.admin_cron_token();
    raise exception 'manager read the cron token';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.verify_cron_token('x');
    raise exception 'manager verified a token';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  perform auth.test_login(v_admin, 'authenticated');
  v_token := public.admin_cron_token();
  if v_token is null or length(v_token) < 32 then raise exception 'token too short: %', v_token; end if;
  if public.admin_cron_token() <> v_token then raise exception 'token should be stable'; end if;
  v_rotated := public.admin_rotate_cron_token();
  if v_rotated = v_token then raise exception 'rotation should change the token'; end if;
  perform auth.test_logout();

  perform set_config('request.jwt.claim.role', 'service_role', true);
  if not public.verify_cron_token(v_rotated) then raise exception 'service role should accept the current token'; end if;
  if public.verify_cron_token(v_token) then raise exception 'the old token must stop working'; end if;
  if public.verify_cron_token('short') then raise exception 'a short token must be refused'; end if;
  if public.verify_cron_token(null) then raise exception 'a null token must be refused'; end if;
  perform set_config('request.jwt.claim.role', '', true);
end $$;
