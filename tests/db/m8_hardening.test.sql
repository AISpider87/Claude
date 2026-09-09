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
