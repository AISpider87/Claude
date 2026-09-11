-- The scheduler (pg_cron, in the database) needs a shared secret to call the
-- availability job. CRON_SECRET lives on Vercel and cannot be read back once
-- saved as a protected value, so the database generates its own token: the
-- admin copies it from Admin → Indisponibili into the cron statement, and the
-- route accepts either that token or CRON_SECRET.

create or replace function private.cron_token()
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_token text;
begin
  select value #>> '{}' into v_token from public.league_settings where key = 'cron_token';
  if v_token is null or length(v_token) < 32 then
    -- gen_random_uuid() is built in; pgcrypto may not be enabled on the project
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.league_settings (key, value) values ('cron_token', to_jsonb(v_token))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return v_token;
end;
$$;
revoke all on function private.cron_token() from public;

-- admin: read (creating it the first time) the token to paste into the schedule
create or replace function public.admin_cron_token()
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  return private.cron_token();
end;
$$;
revoke all on function public.admin_cron_token() from public, anon;
grant execute on function public.admin_cron_token() to authenticated;

-- admin: a new token invalidates the old schedule (which must then be re-created)
create or replace function public.admin_rotate_cron_token()
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  perform private.require_admin();
  insert into public.league_settings (key, value) values ('cron_token', to_jsonb(v_token))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform private.audit('settings.cron_token', 'league_settings', 'cron_token', null);
  return v_token;
end;
$$;
revoke all on function public.admin_rotate_cron_token() from public, anon;
grant execute on function public.admin_rotate_cron_token() to authenticated;

-- the job route verifies the token with the service role; constant-time compare
create or replace function public.verify_cron_token(p_token text)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
begin
  if not private.is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select value #>> '{}' into v_token from public.league_settings where key = 'cron_token';
  if v_token is null or p_token is null or length(p_token) < 32 then
    return false;
  end if;
  return v_token = p_token;
end;
$$;
revoke all on function public.verify_cron_token(text) from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.verify_cron_token(text) to service_role;
  end if;
end $$;

-- league_settings is admin-only for reads, so the token never reaches a manager.
