-- M1: profiles, roles, league settings, league-code gate for signup.
-- Conventions: .claude/skills/supabase-conventions/SKILL.md

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- league_settings: key/value configuration (league_code, budgets, rules...)
-- ---------------------------------------------------------------------------
create table public.league_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.league_settings enable row level security;
revoke all on public.league_settings from anon, authenticated;
-- SELECT is granted; the RLS policy below restricts rows to admins only.
grant select on public.league_settings to authenticated;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  role text not null default 'manager' check (role in ('admin', 'manager')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

create index idx_profiles_role on public.profiles (role);

-- ---------------------------------------------------------------------------
-- helpers (private schema: not exposed through the API)
-- ---------------------------------------------------------------------------
create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function private.is_league_member()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_active
  );
$$;

grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_league_member() to authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_touch
before update on public.profiles
for each row execute function private.touch_updated_at();

create trigger trg_league_settings_touch
before update on public.league_settings
for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- signup: create profile; the bootstrap admin email becomes admin automatically
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_role text := 'manager';
  v_bootstrap text;
begin
  v_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
  if v_name is null then
    v_name := split_part(new.email, '@', 1);
  end if;
  v_name := left(v_name, 40);
  if char_length(v_name) < 2 then
    v_name := rpad(v_name, 2, '_');
  end if;

  select value #>> '{}' into v_bootstrap
  from public.league_settings where key = 'bootstrap_admin_email';

  if v_bootstrap is not null and lower(new.email) = lower(v_bootstrap) then
    v_role := 'admin';
  end if;

  insert into public.profiles (user_id, display_name, role)
  values (new.id, v_name, v_role);
  return new;
end;
$$;

create trigger trg_on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- league code check (callable by anon during signup; reveals only a boolean)
-- ---------------------------------------------------------------------------
create or replace function public.validate_league_code(code text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.league_settings
    where key = 'league_code'
      and upper(trim(value #>> '{}')) = upper(trim(coalesce(code, '')))
      and char_length(trim(coalesce(code, ''))) >= 4
  );
$$;

revoke all on function public.validate_league_code(text) from public;
grant execute on function public.validate_league_code(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- admin-only mutations
-- ---------------------------------------------------------------------------
create or replace function public.set_user_role(target_user uuid, new_role text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if new_role not in ('admin', 'manager') then
    raise exception 'INVALID_ROLE' using errcode = '22023';
  end if;
  if target_user = auth.uid() and new_role <> 'admin' then
    raise exception 'CANNOT_DEMOTE_SELF' using errcode = '22023';
  end if;
  update public.profiles set role = new_role where user_id = target_user;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.set_user_active(target_user uuid, active boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if target_user = auth.uid() and not active then
    raise exception 'CANNOT_DEACTIVATE_SELF' using errcode = '22023';
  end if;
  update public.profiles set is_active = active where user_id = target_user;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.update_my_display_name(new_name text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  update public.profiles
  set display_name = left(trim(new_name), 40)
  where user_id = auth.uid();
end;
$$;

revoke all on function public.set_user_role(uuid, text) from public;
revoke all on function public.set_user_active(uuid, boolean) from public;
revoke all on function public.update_my_display_name(text) from public;
grant execute on function public.set_user_role(uuid, text) to authenticated;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;
grant execute on function public.update_my_display_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
create policy "profiles: members read all"
on public.profiles for select
to authenticated
using (user_id = auth.uid() or private.is_league_member());

create policy "league_settings: admin read"
on public.league_settings for select
to authenticated
using (private.is_admin());

-- Writes to league_settings happen only through admin functions (later milestones).
