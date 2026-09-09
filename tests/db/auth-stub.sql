-- Minimal stand-in for Supabase's auth schema and roles, so migrations and
-- RLS can be tested on a plain PostgreSQL when Docker/Supabase CLI are unavailable.
-- Never applied to a real Supabase project.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants EXECUTE on new public functions directly to these roles.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Test helpers: impersonate a user/role the way PostgREST does.
create or replace function auth.test_login(user_id uuid, db_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(user_id::text, ''), true);
  execute format('set local role %I', db_role);
end $$;

create or replace function auth.test_logout() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  reset role;
end $$;
