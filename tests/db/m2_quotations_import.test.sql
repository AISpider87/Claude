-- M2: quotations import (upsert by id, snapshots, out-of-list, stats, guards), RLS on domain tables.
do $$
declare
  v_admin uuid;
  v_manager uuid;
  v_import uuid;
  v_import2 uuid;
  v_stats jsonb;
  v_count int;
  v_status text;
  v_payload jsonb;
begin
  -- Start from an empty listone regardless of the dev seed (rolled back with the test).
  delete from public.player_quotations;
  delete from public.roster_players;
  delete from public.players;

  insert into auth.users (email, raw_user_meta_data)
  values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "superlega-dev"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data)
  values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_manager;

  v_payload := jsonb_build_object(
    'rows', jsonb_build_array(
      jsonb_build_object('id', 1, 'name', 'Svilar', 'team', 'Roma', 'role_classic', 'P', 'role_mantra', 'Por', 'qt_a', 18, 'qt_i', 18, 'diff', 0, 'fvm', 83),
      jsonb_build_object('id', 2, 'name', 'Dimarco', 'team', 'Inter', 'role_classic', 'D', 'role_mantra', 'E;W', 'qt_a', 31, 'qt_i', 32, 'diff', -1, 'fvm', 250),
      jsonb_build_object('id', 3, 'name', 'Paz N.', 'team', 'Como', 'role_classic', 'C', 'qt_a', 30, 'qt_i', 30, 'diff', 0),
      jsonb_build_object('id', 4, 'name', 'Malen', 'team', 'Roma', 'role_classic', 'A', 'qt_a', 37, 'qt_i', 34, 'diff', 3)
    ),
    'out_of_list_ids', '[]'::jsonb
  );

  -- manager cannot create or apply imports
  perform auth.test_login(v_manager, 'authenticated');
  begin
    perform public.create_quotations_import('manual', 'q.xlsx', null, v_payload, '{}');
    raise exception 'manager could create an import';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  -- admin: first import creates everything
  perform auth.test_login(v_admin, 'authenticated');
  v_import := public.create_quotations_import('manual', 'q.xlsx', 'imports/q.xlsx', v_payload, '{"anomalies": 0}');
  v_stats := public.apply_quotations_import(v_import);
  if (v_stats ->> 'new')::int <> 4 or (v_stats ->> 'rows')::int <> 4 then
    raise exception 'first import stats wrong: %', v_stats;
  end if;
  if (v_stats ->> 'anomalies')::int <> 0 then raise exception 'preview stats not preserved'; end if;
  select count(*) into v_count from public.players where status = 'active';
  if v_count <> 4 then raise exception 'expected 4 active players, got %', v_count; end if;
  select count(*) into v_count from public.player_quotations where import_id = v_import;
  if v_count <> 4 then raise exception 'expected 4 snapshots'; end if;
  select status into v_status from public.imports where id = v_import;
  if v_status <> 'applied' then raise exception 'import not applied'; end if;
  perform 1 from public.imports where id = v_import and payload is null;
  if not found then raise exception 'payload should be cleared after apply'; end if;

  -- applying twice is rejected
  begin
    perform public.apply_quotations_import(v_import);
    raise exception 'double apply allowed';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- second import: Dimarco changes a lot (notable), Paz missing (out of list),
  -- Malen ceded via sheet, a new player appears, Svilar unchanged
  v_payload := jsonb_build_object(
    'rows', jsonb_build_array(
      jsonb_build_object('id', 1, 'name', 'Svilar', 'team', 'Roma', 'role_classic', 'P', 'role_mantra', 'Por', 'qt_a', 18, 'qt_i', 18, 'diff', 0, 'fvm', 83),
      jsonb_build_object('id', 2, 'name', 'Dimarco', 'team', 'Inter', 'role_classic', 'D', 'role_mantra', 'E;W', 'qt_a', 24, 'qt_i', 32, 'diff', -8, 'fvm', 200),
      jsonb_build_object('id', 4, 'name', 'Malen', 'team', 'Roma', 'role_classic', 'A', 'qt_a', 37, 'qt_i', 34, 'diff', 3),
      jsonb_build_object('id', 5, 'name', 'Nuovo', 'team', 'Genoa', 'role_classic', 'A', 'qt_a', 1, 'qt_i', 1, 'diff', 0)
    ),
    'out_of_list_ids', '[4]'::jsonb
  );
  v_import2 := public.create_quotations_import('manual', 'q2.xlsx', null, v_payload, '{}');
  v_stats := public.apply_quotations_import(v_import2);
  if (v_stats ->> 'new')::int <> 1 then raise exception 'expected 1 new: %', v_stats; end if;
  if (v_stats ->> 'updated')::int <> 1 then raise exception 'expected 1 updated: %', v_stats; end if;
  if (v_stats ->> 'unchanged')::int <> 2 then raise exception 'expected 2 unchanged: %', v_stats; end if;
  if (v_stats ->> 'out_of_list')::int <> 2 then raise exception 'expected 2 out of list: %', v_stats; end if;
  if jsonb_array_length(v_stats -> 'notable_changes') <> 1
     or (v_stats -> 'notable_changes' -> 0 ->> 'name') <> 'Dimarco' then
    raise exception 'notable changes wrong: %', v_stats -> 'notable_changes';
  end if;
  perform 1 from public.players where id = 3 and status = 'out_of_list' and out_of_list_at is not null;
  if not found then raise exception 'missing player not marked out of list'; end if;
  perform 1 from public.players where id = 4 and status = 'out_of_list';
  if not found then raise exception 'ceded player not marked out of list'; end if;
  perform 1 from public.players where id = 2 and qt_a = 24;
  if not found then raise exception 'quotation not updated'; end if;
  select count(*) into v_count from public.player_quotations where player_id = 2;
  if v_count <> 2 then raise exception 'history should have 2 snapshots for Dimarco'; end if;
  select count(*) into v_count from public.players;
  if v_count <> 5 then raise exception 'players must never be deleted'; end if;

  -- third import revives Paz (back in the file) and Malen (no longer ceded)
  v_payload := jsonb_set(v_payload, '{rows}', (v_payload -> 'rows') || jsonb_build_object('id', 3, 'name', 'Paz N.', 'team', 'Como', 'role_classic', 'C', 'qt_a', 30, 'qt_i', 30, 'diff', 0));
  v_payload := jsonb_set(v_payload, '{out_of_list_ids}', '[]'::jsonb);
  v_import := public.create_quotations_import('manual', 'q3.xlsx', null, v_payload, '{}');
  v_stats := public.apply_quotations_import(v_import);
  if (v_stats ->> 'revived')::int <> 2 then raise exception 'expected 2 revived: %', v_stats; end if;
  perform 1 from public.players where id = 3 and status = 'active' and out_of_list_at is null;
  if not found then raise exception 'revive failed'; end if;
  perform 1 from public.players where id = 4 and status = 'active';
  if not found then raise exception 'Malen should be active again (present, not ceded)'; end if;

  -- guard: a tiny file must not wipe the list
  v_import := public.create_quotations_import('manual', 'tiny.xlsx', null,
    jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('id', 1, 'name', 'Svilar', 'team', 'Roma', 'role_classic', 'P', 'qt_a', 18, 'qt_i', 18, 'diff', 0)), 'out_of_list_ids', '[]'::jsonb), '{}');
  begin
    perform public.apply_quotations_import(v_import);
    raise exception 'tiny import accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.fail_import(v_import, 'too small');
  select status into v_status from public.imports where id = v_import;
  if v_status <> 'failed' then raise exception 'fail_import did not mark failed'; end if;

  -- free_agents view: nobody owns anyone yet
  select count(*) into v_count from public.free_agents;
  if v_count <> 5 then raise exception 'free_agents should list 5, got %', v_count; end if;

  -- audit trail written
  select count(*) into v_count from public.audit_log where action in ('import.preview', 'import.apply');
  if v_count < 5 then raise exception 'audit entries missing'; end if;
  perform auth.test_logout();

  -- manager reads players and free agents, not imports/audit; cannot write players
  perform auth.test_login(v_manager, 'authenticated');
  select count(*) into v_count from public.players;
  if v_count <> 5 then raise exception 'manager should read players'; end if;
  select count(*) into v_count from public.free_agents;
  if v_count <> 5 then raise exception 'manager should read free agents'; end if;
  select count(*) into v_count from public.imports;
  if v_count <> 0 then raise exception 'manager could read imports'; end if;
  select count(*) into v_count from public.audit_log;
  if v_count <> 0 then raise exception 'manager could read audit_log'; end if;
  begin
    update public.players set qt_a = 99 where id = 1;
    raise exception 'manager could update players';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.transactions (team_id, kind) values (gen_random_uuid(), 'swap');
    raise exception 'manager could insert transactions';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  -- ledger and audit are immutable even for superuser-level callers
  begin
    delete from public.audit_log;
    raise exception 'audit_log delete allowed';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;
