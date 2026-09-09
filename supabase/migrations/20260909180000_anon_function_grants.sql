-- Security review (v1): on Supabase the `anon` role receives EXECUTE on every
-- public function through default privileges, and `revoke ... from public`
-- does not touch that direct grant. The quotations-import functions accept a
-- null auth.uid() (service-role cron), so an unauthenticated caller could run
-- them. Only the anonymous attempt limiter is meant to be callable without a
-- session: revoke everything else, now and for future functions.

revoke execute on all functions in schema public from anon;
-- New functions: no implicit EXECUTE for anyone (PostgreSQL grants PUBLIC by
-- default, Supabase adds anon/authenticated/service_role); every function in
-- this project grants its callers explicitly.
-- PUBLIC's implicit EXECUTE is a global default, so it must be revoked
-- globally (a per-schema revoke cannot override a global grant); anon's grant
-- is per-schema on Supabase.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
do $$
begin
  -- Supabase runs migrations as postgres; cover its default privileges too.
  if exists (select 1 from pg_roles where rolname = 'postgres') and current_user <> 'postgres' then
    execute 'alter default privileges for role postgres revoke execute on functions from public';
    execute 'alter default privileges for role postgres in schema public revoke execute on functions from anon';
  end if;
end $$;
grant execute on function public.consume_anonymous_attempt(text, text) to anon;

-- Anonymous limiter: bound the table deterministically (security review M1).
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
  v_bucket text;
begin
  case p_bucket
    when 'login'  then v_max := 10; v_window := 900;
    when 'signup' then v_max := 5;  v_window := 3600;
    when 'reset'  then v_max := 5;  v_window := 3600;
    else raise exception 'UNKNOWN_BUCKET' using errcode = '22023';
  end case;
  if p_key is null or char_length(p_key) < 3 or char_length(p_key) > 320 then
    raise exception 'INVALID_KEY' using errcode = '22023';
  end if;
  v_bucket := 'anon:' || p_bucket;
  v_id := md5(v_bucket || ':' || p_key)::uuid;

  -- Expired windows of this bucket are removed on every call, so live rows are
  -- bounded by the distinct keys active inside one window.
  delete from private.rate_limits
  where bucket = v_bucket and window_start < now() - make_interval(secs => v_window);
  -- Hard cap against key-spraying: past it, refuse new keys instead of growing.
  if (select count(*) from private.rate_limits where bucket = v_bucket) >= 5000
     and not exists (select 1 from private.rate_limits where user_id = v_id and bucket = v_bucket) then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;

  insert into private.rate_limits (user_id, bucket, window_start, hits)
  values (v_id, v_bucket, now(), 1)
  on conflict (user_id, bucket) do update
  set hits = case when private.rate_limits.window_start < now() - make_interval(secs => v_window)
                  then 1 else private.rate_limits.hits + 1 end,
      window_start = case when private.rate_limits.window_start < now() - make_interval(secs => v_window)
                          then now() else private.rate_limits.window_start end
  returning hits into v_hits;

  if v_hits > v_max then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
end;
$$;
revoke all on function public.consume_anonymous_attempt(text, text) from public;
grant execute on function public.consume_anonymous_attempt(text, text) to anon, authenticated;
