-- M8: application-level throttling for anonymous auth attempts (login, signup,
-- password reset). Supabase Auth already limits per IP; this adds a per
-- (bucket, key) limit the app controls, keyed on a hash of ip + email so a
-- single address cannot be hammered from one client.

create or replace function public.consume_anonymous_attempt(p_bucket text, p_key text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_max integer;
  v_window integer;
  v_hits integer;
  v_id uuid;
begin
  case p_bucket
    when 'login'  then v_max := 10; v_window := 900;
    when 'signup' then v_max := 5;  v_window := 3600;
    when 'reset'  then v_max := 5;  v_window := 3600;
    else raise exception 'UNKNOWN_BUCKET' using errcode = '22023';
  end case;
  if p_key is null or char_length(p_key) < 3 then
    raise exception 'INVALID_KEY' using errcode = '22023';
  end if;
  -- Namespaced hash so anonymous keys can never collide with real user ids.
  v_id := md5('anon:' || p_bucket || ':' || p_key)::uuid;

  insert into private.rate_limits (user_id, bucket, window_start, hits)
  values (v_id, 'anon:' || p_bucket, now(), 1)
  on conflict (user_id, bucket) do update
  set hits = case when private.rate_limits.window_start < now() - make_interval(secs => v_window)
                  then 1 else private.rate_limits.hits + 1 end,
      window_start = case when private.rate_limits.window_start < now() - make_interval(secs => v_window)
                          then now() else private.rate_limits.window_start end
  returning hits into v_hits;

  -- Opportunistic cleanup keeps the table small (windows are at most one hour).
  if random() < 0.02 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;

  if v_hits > v_max then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
end;
$$;
revoke all on function public.consume_anonymous_attempt(text, text) from public;
grant execute on function public.consume_anonymous_attempt(text, text) to anon, authenticated;
