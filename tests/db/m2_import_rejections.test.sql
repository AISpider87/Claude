-- M2 QA: rejection paths and RLS not covered by m2_quotations_import.test.sql.
-- NOTE: the first block (payload without "rows") FAILS on purpose: it reproduces the
-- bug in apply/create_quotations_import (jsonb_typeof(NULL) <> 'array' is NULL, so
-- a payload with no "rows" key is accepted and gets applied as a 0-row import).
do $$
declare
  v_admin uuid;
  v_manager uuid;
  v_inactive_admin uuid;
  v_payload jsonb;
  v_import uuid;
  v_count int;
begin
  insert into auth.users (email, raw_user_meta_data)
  values ('admin@superlega.local', '{"display_name": "Daniele", "league_code": "SUPERLEGA-DEV"}') returning id into v_admin;
  insert into auth.users (email, raw_user_meta_data)
  values ('mario@example.com', '{"display_name": "Mario", "league_code": "SUPERLEGA-DEV"}') returning id into v_manager;
  insert into auth.users (email, raw_user_meta_data)
  values ('ex-admin@example.com', '{"display_name": "Ex Admin", "league_code": "SUPERLEGA-DEV"}') returning id into v_inactive_admin;
  update public.profiles set role = 'admin', is_active = false where user_id = v_inactive_admin;

  v_payload := jsonb_build_object(
    'rows', jsonb_build_array(
      jsonb_build_object('id', 1, 'name', 'Svilar', 'team', 'Roma', 'role_classic', 'P', 'qt_a', 18, 'qt_i', 18, 'diff', 0)),
    'out_of_list_ids', '[]'::jsonb);

  perform auth.test_login(v_admin, 'authenticated');

  -- BUG (open): a payload without "rows" must be rejected as INVALID_PAYLOAD
  begin
    perform public.create_quotations_import('manual', 'norows.xlsx', null, '{"nope": 1}'::jsonb, '{}');
    raise exception 'payload without "rows" accepted (jsonb_typeof(NULL) <> ''array'' is NULL)';
  exception when invalid_parameter_value then null;
  end;

  -- admin can only write imports/players/audit through functions
  v_import := public.create_quotations_import('manual', 'q.xlsx', null, v_payload, '{}');
  begin
    insert into public.imports (kind, source) values ('quotations', 'manual');
    raise exception 'admin inserted into imports directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.imports set status = 'applied' where id = v_import;
    raise exception 'admin updated imports directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.audit_log (action) values ('x');
    raise exception 'admin inserted into audit_log directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.players where id = 5841;
    raise exception 'admin deleted a player directly';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  -- manager: cannot apply, discard, or create an "auto" import
  perform auth.test_login(v_manager, 'authenticated');
  begin
    perform public.apply_quotations_import(v_import);
    raise exception 'manager applied an import';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fail_import(v_import, 'x');
    raise exception 'manager discarded an import';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_quotations_import('auto', 'x', null, v_payload, '{}');
    raise exception 'manager created an auto import';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();

  -- deactivated admin: no import rights, no league data
  perform auth.test_login(v_inactive_admin, 'authenticated');
  begin
    perform public.create_quotations_import('manual', 'x', null, v_payload, '{}');
    raise exception 'inactive admin created an import';
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_count from public.players;
  if v_count <> 0 then raise exception 'inactive user reads players (%)', v_count; end if;
  select count(*) into v_count from public.free_agents;
  if v_count <> 0 then raise exception 'inactive user reads free_agents (%)', v_count; end if;
  perform auth.test_logout();

  -- anon: no execute on import functions, no read on players
  perform auth.test_login(null, 'anon');
  begin
    perform public.apply_quotations_import(v_import);
    raise exception 'anon executed apply_quotations_import';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.players;
    raise exception 'anon read players';
  exception when insufficient_privilege then null;
  end;
  perform auth.test_logout();
end $$;
