-- M8: anonymous attempt limiter (login 10/15 min per key), unknown buckets refused.
do $$
declare
  i integer;
begin
  perform auth.test_logout();
  set local role anon;
  for i in 1..10 loop
    perform public.consume_anonymous_attempt('login', '203.0.113.7|mario@example.com');
  end loop;
  begin
    perform public.consume_anonymous_attempt('login', '203.0.113.7|mario@example.com');
    raise exception 'login limit not enforced';
  exception when program_limit_exceeded then null;
  end;
  -- a different key (other address) is not affected
  perform public.consume_anonymous_attempt('login', '203.0.113.7|anna@example.com');
  begin
    perform public.consume_anonymous_attempt('made-up', 'x');
    raise exception 'unknown bucket accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.consume_anonymous_attempt('login', '');
    raise exception 'empty key accepted';
  exception when invalid_parameter_value then null;
  end;
  reset role;
end $$;

-- Security review C1: with Supabase-style default privileges, anon must not be
-- able to execute any public function except the anonymous attempt limiter.
do $$
declare
  v_fn text;
  v_count int;
begin
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname <> 'consume_anonymous_attempt';
  if v_count > 0 then
    select string_agg(p.proname, ', ') into v_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
      and p.proname <> 'consume_anonymous_attempt';
    raise exception 'anon can execute public functions: %', v_fn;
  end if;

  perform auth.test_logout();
  set local role anon;
  begin
    perform public.create_quotations_import('auto', 'x.xlsx', null, '{"rows": []}'::jsonb, '{}'::jsonb);
    raise exception 'anon created a quotations import';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fail_import(gen_random_uuid(), 'x');
    raise exception 'anon could call fail_import';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- a function created after the migration inherits the revocation
  execute 'create function public.__probe_later() returns int language sql as $f$ select 1 $f$';
  if has_function_privilege('anon', 'public.__probe_later()', 'execute') then
    raise exception 'default privileges still grant anon execute on new functions';
  end if;
  execute 'drop function public.__probe_later()';
end $$;

-- Security review M1: expired anonymous limiter rows are cleaned on every call.
do $$
declare
  v_rows int;
begin
  perform auth.test_logout();
  set local role anon;
  perform public.consume_anonymous_attempt('reset', 'ip-a');
  perform public.consume_anonymous_attempt('reset', 'ip-b');
  reset role;
  update private.rate_limits set window_start = now() - interval '2 hours' where bucket = 'anon:reset';
  set local role anon;
  perform public.consume_anonymous_attempt('reset', 'ip-c');
  reset role;
  select count(*) into v_rows from private.rate_limits where bucket = 'anon:reset';
  if v_rows <> 1 then raise exception 'expired limiter rows not cleaned (% rows)', v_rows; end if;
end $$;
