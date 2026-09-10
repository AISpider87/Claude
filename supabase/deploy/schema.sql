-- SuperLega — schema completo per Supabase (generato da supabase/migrations/*).
-- Incollare nella dashboard: SQL Editor > New query > Run. Eseguire UNA volta sola.
-- Rigenerare con: scripts/build-deploy-sql.sh

-- ===== 20260909120000_auth_profiles.sql =====
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
-- league code check (internal: enforced by the signup trigger, never exposed
-- through the API so it cannot be brute-forced outside Auth's rate limits)
-- ---------------------------------------------------------------------------
create or replace function private.league_code_matches(p_code text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.league_settings
    where key = 'league_code'
      and char_length(trim(coalesce(p_code, ''))) >= 4
      and upper(trim(value #>> '{}')) = upper(trim(p_code))
  );
$$;
revoke all on function private.league_code_matches(text) from public;

-- ---------------------------------------------------------------------------
-- signup: the league code travels in the signup metadata and is validated
-- here, so the gate holds even for direct calls to the Auth API. Profile is
-- created; the bootstrap admin email becomes admin automatically.
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
  if not private.league_code_matches(new.raw_user_meta_data ->> 'league_code') then
    raise exception 'INVALID_LEAGUE_CODE' using errcode = '42501';
  end if;

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

-- ===== 20260909130000_core_schema.sql =====
-- M2: core domain schema (listone, imports, quotation history, teams, rosters,
-- market sessions, transactions, audit log) + quotations import function.
-- Market functions (swap, sessions, reversal) arrive in M4.

-- ---------------------------------------------------------------------------
-- audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid,
  action text not null,
  entity text,
  entity_id text,
  payload jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
create index idx_audit_log_created_at on public.audit_log (created_at desc);

create or replace function private.audit(
  p_action text, p_entity text default null, p_entity_id text default null, p_payload jsonb default null
) returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_log (user_id, action, entity, entity_id, payload)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_payload);
$$;
revoke all on function private.audit(text, text, text, jsonb) from public;

create or replace function private.forbid_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'IMMUTABLE_ROW' using errcode = '55000';
end;
$$;

create trigger trg_audit_log_immutable
before update or delete on public.audit_log
for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- league settings defaults + typed readers
-- ---------------------------------------------------------------------------
insert into public.league_settings (key, value) values
  ('initial_budget', '250'),
  ('roster_composition', '{"P": 3, "D": 7, "C": 7, "A": 6}'),
  ('season_swap_limit', '20'),
  ('session_extra_budget', '5'),
  ('sale_price_rule', '"current_quotation"'),
  ('free_swap_refund_rule', '"price_paid"'),
  ('quotation_change_alert_threshold', '5'),
  ('import_min_rows_ratio', '0.5'),
  ('sync_enabled', 'true'),
  ('sync_hour', '6')
on conflict (key) do nothing;

create or replace function private.setting_int(p_key text, p_default integer default null)
returns integer
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select (value #>> '{}')::integer from public.league_settings where key = p_key), p_default);
$$;

create or replace function private.setting_json(p_key text)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select value from public.league_settings where key = p_key;
$$;
revoke all on function private.setting_int(text, integer) from public;
revoke all on function private.setting_json(text) from public;

create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.league_settings (key, value, updated_by)
  values (p_key, p_value, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  perform private.audit('setting.update', 'league_settings', p_key,
    case when p_key = 'league_code' then null else jsonb_build_object('value', p_value) end);
end;
$$;
revoke all on function public.admin_set_setting(text, jsonb) from public;
grant execute on function public.admin_set_setting(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- players (listone)
-- ---------------------------------------------------------------------------
create table public.players (
  id integer primary key,
  name text not null,
  team text not null,
  role_classic text not null check (role_classic in ('P', 'D', 'C', 'A')),
  role_mantra text,
  qt_a integer not null default 0,
  qt_i integer not null default 0,
  diff integer not null default 0,
  qt_a_m integer,
  qt_i_m integer,
  diff_m integer,
  fvm integer,
  fvm_m integer,
  status text not null default 'active' check (status in ('active', 'out_of_list')),
  out_of_list_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.players enable row level security;
revoke all on public.players from anon, authenticated;
grant select on public.players to authenticated;
create index idx_players_name on public.players (lower(name));
create index idx_players_role_status on public.players (role_classic, status);
create index idx_players_team on public.players (team);
create trigger trg_players_touch before update on public.players
for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- imports (quotations / rosters), with parsed payload kept until applied
-- ---------------------------------------------------------------------------
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('quotations', 'rosters')),
  source text not null check (source in ('manual', 'auto')),
  file_name text,
  file_path text,
  status text not null default 'previewed' check (status in ('previewed', 'applied', 'failed')),
  payload jsonb,
  stats jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
alter table public.imports enable row level security;
revoke all on public.imports from anon, authenticated;
grant select on public.imports to authenticated;
create index idx_imports_created_at on public.imports (created_at desc);

-- ---------------------------------------------------------------------------
-- quotation history: one snapshot per applied import
-- ---------------------------------------------------------------------------
create table public.player_quotations (
  import_id uuid not null references public.imports (id) on delete cascade,
  player_id integer not null references public.players (id) on delete cascade,
  qt_a integer not null,
  qt_i integer not null,
  diff integer not null,
  qt_a_m integer,
  qt_i_m integer,
  diff_m integer,
  fvm integer,
  fvm_m integer,
  recorded_at timestamptz not null default now(),
  primary key (import_id, player_id)
);
alter table public.player_quotations enable row level security;
revoke all on public.player_quotations from anon, authenticated;
grant select on public.player_quotations to authenticated;
create index idx_player_quotations_player on public.player_quotations (player_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 60),
  short_name text not null check (char_length(short_name) between 2 and 4),
  color_primary text not null default '#38bdf8' check (color_primary ~ '^#[0-9a-fA-F]{6}$'),
  color_secondary text not null default '#0b1220' check (color_secondary ~ '^#[0-9a-fA-F]{6}$'),
  owner_id uuid unique references public.profiles (user_id) on delete set null,
  credits integer not null default 250 check (credits >= 0),
  swaps_used integer not null default 0 check (swaps_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.teams enable row level security;
revoke all on public.teams from anon, authenticated;
grant select on public.teams to authenticated;
create trigger trg_teams_touch before update on public.teams
for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- roster_players: current roster = rows with released_at is null.
-- NO global uniqueness on player_id: ownership is not exclusive (SPEC §3).
-- ---------------------------------------------------------------------------
create table public.roster_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id integer not null references public.players (id),
  price_paid integer not null check (price_paid >= 0),
  acquired_at timestamptz not null default now(),
  acquired_via text not null check (acquired_via in ('initial_import', 'admin', 'swap', 'free_swap', 'reversal')),
  released_at timestamptz,
  released_via text check (released_via in ('swap', 'free_swap', 'admin', 'reversal')),
  check ((released_at is null) = (released_via is null))
);
alter table public.roster_players enable row level security;
revoke all on public.roster_players from anon, authenticated;
grant select on public.roster_players to authenticated;
create unique index uq_roster_players_active on public.roster_players (team_id, player_id)
  where released_at is null;
create index idx_roster_players_team_active on public.roster_players (team_id) where released_at is null;
create index idx_roster_players_player_active on public.roster_players (player_id) where released_at is null;

-- ---------------------------------------------------------------------------
-- market sessions + free-agent snapshot
-- ---------------------------------------------------------------------------
create table public.market_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'open', 'closed')),
  extra_budget integer not null default 5 check (extra_budget >= 0),
  extra_budget_applied boolean not null default false,
  opened_at timestamptz,
  closed_at timestamptz,
  validation_report jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at)
);
alter table public.market_sessions enable row level security;
revoke all on public.market_sessions from anon, authenticated;
grant select on public.market_sessions to authenticated;
create unique index uq_market_sessions_single_open on public.market_sessions ((status))
  where status = 'open';
create index idx_market_sessions_opens_at on public.market_sessions (opens_at desc);
create trigger trg_market_sessions_touch before update on public.market_sessions
for each row execute function private.touch_updated_at();

create table public.session_free_agents (
  session_id uuid not null references public.market_sessions (id) on delete cascade,
  player_id integer not null references public.players (id) on delete cascade,
  primary key (session_id, player_id)
);
alter table public.session_free_agents enable row level security;
revoke all on public.session_free_agents from anon, authenticated;
grant select on public.session_free_agents to authenticated;

-- ---------------------------------------------------------------------------
-- transactions: immutable ledger
-- ---------------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id),
  session_id uuid references public.market_sessions (id),
  kind text not null check (kind in ('swap', 'free_swap', 'admin_assign', 'admin_remove', 'reversal')),
  player_out_id integer references public.players (id),
  player_out_price integer check (player_out_price is null or player_out_price >= 0),
  player_in_id integer references public.players (id),
  player_in_price integer check (player_in_price is null or player_in_price >= 0),
  credits_delta integer not null default 0,
  counts_toward_limit boolean not null default false,
  note text,
  reversal_of uuid unique references public.transactions (id),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.transactions enable row level security;
revoke all on public.transactions from anon, authenticated;
grant select on public.transactions to authenticated;
create index idx_transactions_team_created on public.transactions (team_id, created_at desc);
create index idx_transactions_created on public.transactions (created_at desc);
create trigger trg_transactions_immutable
before update or delete on public.transactions
for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- RLS: the whole league reads domain tables; admin-only tables stay admin-only
-- ---------------------------------------------------------------------------
create policy "players: members read" on public.players for select to authenticated
  using (private.is_league_member());
create policy "player_quotations: members read" on public.player_quotations for select to authenticated
  using (private.is_league_member());
create policy "teams: members read" on public.teams for select to authenticated
  using (private.is_league_member());
create policy "roster_players: members read" on public.roster_players for select to authenticated
  using (private.is_league_member());
create policy "market_sessions: members read" on public.market_sessions for select to authenticated
  using (private.is_league_member());
create policy "session_free_agents: members read" on public.session_free_agents for select to authenticated
  using (private.is_league_member());
create policy "transactions: members read" on public.transactions for select to authenticated
  using (private.is_league_member());
create policy "imports: admin read" on public.imports for select to authenticated
  using (private.is_admin());
create policy "audit_log: admin read" on public.audit_log for select to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- free agents view: active players owned by nobody (derived, never stored)
-- ---------------------------------------------------------------------------
create view public.free_agents
with (security_invoker = true)
as
  select p.*
  from public.players p
  where p.status = 'active'
    and not exists (
      select 1 from public.roster_players r
      where r.player_id = p.id and r.released_at is null
    );
revoke all on public.free_agents from anon, authenticated;
grant select on public.free_agents to authenticated;

-- ---------------------------------------------------------------------------
-- quotations import
-- payload: {"rows": [{id, name, team, role_classic, role_mantra, qt_a, qt_i, diff,
--            qt_a_m, qt_i_m, diff_m, fvm, fvm_m}], "out_of_list_ids": [..]}
-- ---------------------------------------------------------------------------
create or replace function public.create_quotations_import(
  p_source text, p_file_name text, p_file_path text, p_payload jsonb, p_stats jsonb
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_source = 'manual' and not private.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_source = 'auto' and auth.uid() is not null and not private.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload -> 'rows') is distinct from 'array' then
    raise exception 'INVALID_PAYLOAD' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload -> 'rows') > 5000 then
    raise exception 'PAYLOAD_TOO_LARGE' using errcode = '22023';
  end if;
  insert into public.imports (kind, source, file_name, file_path, payload, stats, created_by)
  values ('quotations', p_source, p_file_name, p_file_path, p_payload, coalesce(p_stats, '{}'::jsonb), auth.uid())
  returning id into v_id;
  perform private.audit('import.preview', 'imports', v_id::text, jsonb_build_object('kind', 'quotations', 'source', p_source));
  return v_id;
end;
$$;
revoke all on function public.create_quotations_import(text, text, text, jsonb, jsonb) from public;
grant execute on function public.create_quotations_import(text, text, text, jsonb, jsonb) to authenticated, service_role;

create or replace function public.apply_quotations_import(p_import_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_import public.imports%rowtype;
  v_threshold integer := private.setting_int('quotation_change_alert_threshold', 5);
  v_min_ratio numeric := coalesce((private.setting_json('import_min_rows_ratio') #>> '{}')::numeric, 0.5);
  v_active_before integer;
  v_rows integer;
  v_new integer;
  v_updated integer;
  v_unchanged integer;
  v_revived integer;
  v_out integer;
  v_notable jsonb;
  v_stats jsonb;
begin
  if not private.is_admin() and auth.uid() is not null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_import from public.imports where id = p_import_id for update;
  if not found or v_import.kind <> 'quotations' then
    raise exception 'IMPORT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_import.status = 'failed' then
    raise exception 'IMPORT_DISCARDED' using errcode = '55000';
  end if;
  if v_import.status <> 'previewed' then
    raise exception 'IMPORT_ALREADY_APPLIED' using errcode = '55000';
  end if;

  -- Several imports may run in one transaction (tests), so never assume a clean session.
  drop table if exists pg_temp.tmp_rows;
  create temp table tmp_rows on commit drop as
  select distinct on ((r ->> 'id')::integer)
    (r ->> 'id')::integer as id,
    r ->> 'name' as name,
    r ->> 'team' as team,
    r ->> 'role_classic' as role_classic,
    nullif(r ->> 'role_mantra', '') as role_mantra,
    coalesce((r ->> 'qt_a')::integer, 0) as qt_a,
    coalesce((r ->> 'qt_i')::integer, 0) as qt_i,
    coalesce((r ->> 'diff')::integer, 0) as diff,
    (r ->> 'qt_a_m')::integer as qt_a_m,
    (r ->> 'qt_i_m')::integer as qt_i_m,
    (r ->> 'diff_m')::integer as diff_m,
    (r ->> 'fvm')::integer as fvm,
    (r ->> 'fvm_m')::integer as fvm_m
  from jsonb_array_elements(v_import.payload -> 'rows') as r;

  select count(*) into v_rows from pg_temp.tmp_rows;
  select count(*) into v_active_before from public.players where status = 'active';
  if v_active_before > 0 and v_rows < v_active_before * v_min_ratio then
    raise exception 'IMPORT_TOO_SMALL' using errcode = '22023',
      detail = format('%s rows vs %s active players', v_rows, v_active_before);
  end if;

  -- notable quotation changes (before upsert)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'from', p.qt_a, 'to', t.qt_a) order by abs(t.qt_a - p.qt_a) desc), '[]'::jsonb)
  into v_notable
  from pg_temp.tmp_rows t join public.players p on p.id = t.id
  where abs(t.qt_a - p.qt_a) >= v_threshold;

  select count(*) into v_new from pg_temp.tmp_rows t where not exists (select 1 from public.players p where p.id = t.id);
  select count(*) into v_revived from pg_temp.tmp_rows t join public.players p on p.id = t.id where p.status = 'out_of_list';
  select count(*) into v_updated
  from pg_temp.tmp_rows t join public.players p on p.id = t.id
  where p.status = 'active' and (
    p.name, p.team, p.role_classic, coalesce(p.role_mantra, ''), p.qt_a, p.qt_i, p.diff,
    coalesce(p.qt_a_m, -1), coalesce(p.qt_i_m, -1), coalesce(p.diff_m, -1), coalesce(p.fvm, -1), coalesce(p.fvm_m, -1)
  ) is distinct from (
    t.name, t.team, t.role_classic, coalesce(t.role_mantra, ''), t.qt_a, t.qt_i, t.diff,
    coalesce(t.qt_a_m, -1), coalesce(t.qt_i_m, -1), coalesce(t.diff_m, -1), coalesce(t.fvm, -1), coalesce(t.fvm_m, -1)
  );
  v_unchanged := v_rows - v_new - v_revived - v_updated;

  insert into public.players (id, name, team, role_classic, role_mantra, qt_a, qt_i, diff, qt_a_m, qt_i_m, diff_m, fvm, fvm_m, status, out_of_list_at)
  select id, name, team, role_classic, role_mantra, qt_a, qt_i, diff, qt_a_m, qt_i_m, diff_m, fvm, fvm_m, 'active', null
  from pg_temp.tmp_rows
  on conflict (id) do update set
    name = excluded.name, team = excluded.team, role_classic = excluded.role_classic,
    role_mantra = excluded.role_mantra, qt_a = excluded.qt_a, qt_i = excluded.qt_i, diff = excluded.diff,
    qt_a_m = excluded.qt_a_m, qt_i_m = excluded.qt_i_m, diff_m = excluded.diff_m,
    fvm = excluded.fvm, fvm_m = excluded.fvm_m, status = 'active', out_of_list_at = null
  where (players.name, players.team, players.role_classic, players.role_mantra, players.qt_a, players.qt_i, players.diff,
         players.qt_a_m, players.qt_i_m, players.diff_m, players.fvm, players.fvm_m, players.status)
    is distinct from
        (excluded.name, excluded.team, excluded.role_classic, excluded.role_mantra, excluded.qt_a, excluded.qt_i, excluded.diff,
         excluded.qt_a_m, excluded.qt_i_m, excluded.diff_m, excluded.fvm, excluded.fvm_m, 'active');

  -- players missing from the file, or listed as ceded, leave the list (never deleted)
  with gone as (
    update public.players p
    set status = 'out_of_list', out_of_list_at = coalesce(p.out_of_list_at, now())
    where p.status = 'active'
      and (
        not exists (select 1 from pg_temp.tmp_rows t where t.id = p.id)
        or p.id in (select (x #>> '{}')::integer from jsonb_array_elements(coalesce(v_import.payload -> 'out_of_list_ids', '[]'::jsonb)) x)
      )
    returning p.id
  )
  select count(*) into v_out from gone;

  insert into public.player_quotations (import_id, player_id, qt_a, qt_i, diff, qt_a_m, qt_i_m, diff_m, fvm, fvm_m)
  select p_import_id, id, qt_a, qt_i, diff, qt_a_m, qt_i_m, diff_m, fvm, fvm_m from pg_temp.tmp_rows;

  v_stats := coalesce(v_import.stats, '{}'::jsonb) || jsonb_build_object(
    'rows', v_rows, 'new', v_new, 'updated', v_updated, 'unchanged', v_unchanged,
    'revived', v_revived, 'out_of_list', v_out, 'notable_changes', v_notable
  );

  update public.imports
  set status = 'applied', applied_at = now(), stats = v_stats, payload = null
  where id = p_import_id;

  perform private.audit('import.apply', 'imports', p_import_id::text, v_stats - 'notable_changes');
  return v_stats;
end;
$$;
revoke all on function public.apply_quotations_import(uuid) from public;
grant execute on function public.apply_quotations_import(uuid) to authenticated, service_role;

create or replace function public.fail_import(p_import_id uuid, p_error text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_admin() and auth.uid() is not null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.imports set status = 'failed', error = left(p_error, 2000), payload = null
  where id = p_import_id and status = 'previewed';
  if found then
    perform private.audit('import.fail', 'imports', p_import_id::text, jsonb_build_object('error', left(p_error, 200)));
  end if;
end;
$$;
revoke all on function public.fail_import(uuid, text) from public;
grant execute on function public.fail_import(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- storage bucket for uploaded files (only when the storage schema exists,
-- i.e. on Supabase; skipped on the plain-Postgres test harness)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('imports', 'imports', false, 5242880,
      array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/vnd.ms-excel'])
    on conflict (id) do nothing;

    execute $p$create policy "imports bucket: admin read" on storage.objects for select to authenticated
      using (bucket_id = 'imports' and private.is_admin())$p$;
    execute $p$create policy "imports bucket: admin write" on storage.objects for insert to authenticated
      with check (bucket_id = 'imports' and private.is_admin())$p$;
  end if;
end $$;

-- ===== 20260909140000_teams_rosters.sql =====
-- M3: team management, manual roster assignment, rosters import.

alter table public.transactions drop constraint transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
  check (kind in ('swap', 'free_swap', 'admin_assign', 'admin_remove', 'admin_credits', 'reversal'));

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function private.require_admin()
returns void
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_admin() from public;

-- 3-letter code from the team name, made unique with a digit suffix if needed.
create or replace function private.make_short_name(p_name text)
returns text
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_candidate text;
  v_i integer := 2;
begin
  v_base := upper(regexp_replace(p_name, '[^A-Za-z0-9]', '', 'g'));
  v_base := left(v_base, 3);
  if char_length(v_base) < 2 then
    v_base := rpad(v_base, 3, 'X');
  end if;
  v_candidate := v_base;
  while exists (select 1 from public.teams where short_name = v_candidate) loop
    v_candidate := left(v_base, 2) || v_i::text;
    v_i := v_i + 1;
  end loop;
  return v_candidate;
end;
$$;
revoke all on function private.make_short_name(text) from public;

-- ---------------------------------------------------------------------------
-- team CRUD (admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_team(
  p_id uuid,
  p_name text,
  p_short_name text default null,
  p_color_primary text default null,
  p_color_secondary text default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
  v_name text := trim(p_name);
begin
  perform private.require_admin();
  if char_length(v_name) < 2 then
    raise exception 'INVALID_NAME' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.teams (name, short_name, color_primary, color_secondary, credits)
    values (
      v_name,
      coalesce(nullif(upper(trim(p_short_name)), ''), private.make_short_name(v_name)),
      coalesce(p_color_primary, '#38bdf8'),
      coalesce(p_color_secondary, '#0b1220'),
      private.setting_int('initial_budget', 250)
    )
    returning id into v_id;
    perform private.audit('team.create', 'teams', v_id::text, jsonb_build_object('name', v_name));
  else
    update public.teams
    set name = v_name,
        short_name = coalesce(nullif(upper(trim(p_short_name)), ''), short_name),
        color_primary = coalesce(p_color_primary, color_primary),
        color_secondary = coalesce(p_color_secondary, color_secondary)
    where id = v_id;
    if not found then
      raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
    end if;
    perform private.audit('team.update', 'teams', v_id::text, jsonb_build_object('name', v_name));
  end if;
  return v_id;
end;
$$;
revoke all on function public.admin_upsert_team(uuid, text, text, text, text) from public;
grant execute on function public.admin_upsert_team(uuid, text, text, text, text) to authenticated;

create or replace function public.admin_set_team_owner(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  if p_user_id is not null and not exists (
    select 1 from public.profiles where user_id = p_user_id and is_active
  ) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- one team per manager: free the user from any other team first
  update public.teams set owner_id = null where owner_id = p_user_id and id <> p_team_id;
  update public.teams set owner_id = p_user_id where id = p_team_id;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.audit('team.owner', 'teams', p_team_id::text, jsonb_build_object('owner_id', p_user_id));
end;
$$;
revoke all on function public.admin_set_team_owner(uuid, uuid) from public;
grant execute on function public.admin_set_team_owner(uuid, uuid) to authenticated;

create or replace function public.admin_set_team_credits(p_team_id uuid, p_credits integer, p_note text default null)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_before integer;
begin
  perform private.require_admin();
  if p_credits < 0 then
    raise exception 'NEGATIVE_CREDITS' using errcode = '23514';
  end if;
  select credits into v_before from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.teams set credits = p_credits where id = p_team_id;
  insert into public.transactions (team_id, kind, credits_delta, note, created_by)
  values (p_team_id, 'admin_credits', p_credits - v_before, p_note, auth.uid());
  perform private.audit('team.credits', 'teams', p_team_id::text,
    jsonb_build_object('from', v_before, 'to', p_credits, 'note', p_note));
end;
$$;
revoke all on function public.admin_set_team_credits(uuid, integer, text) from public;
grant execute on function public.admin_set_team_credits(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- manual roster changes (admin): corrections and initial assignment from UI
-- ---------------------------------------------------------------------------
create or replace function public.admin_assign_player(p_team_id uuid, p_player_id integer, p_price integer, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_credits integer;
  v_tx uuid;
begin
  perform private.require_admin();
  if p_price < 0 then
    raise exception 'INVALID_PRICE' using errcode = '22023';
  end if;
  select credits into v_credits from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.roster_players
    where team_id = p_team_id and player_id = p_player_id and released_at is null
  ) then
    raise exception 'ALREADY_IN_ROSTER' using errcode = '23505';
  end if;
  if v_credits - p_price < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;

  insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
  values (p_team_id, p_player_id, p_price, 'admin');
  update public.teams set credits = credits - p_price where id = p_team_id;
  insert into public.transactions (team_id, kind, player_in_id, player_in_price, credits_delta, note, created_by)
  values (p_team_id, 'admin_assign', p_player_id, p_price, -p_price, p_note, auth.uid())
  returning id into v_tx;
  perform private.audit('roster.assign', 'teams', p_team_id::text,
    jsonb_build_object('player_id', p_player_id, 'price', p_price));
  return v_tx;
end;
$$;
revoke all on function public.admin_assign_player(uuid, integer, integer, text) from public;
grant execute on function public.admin_assign_player(uuid, integer, integer, text) to authenticated;

create or replace function public.admin_remove_player(p_team_id uuid, p_player_id integer, p_refund integer default 0, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tx uuid;
begin
  perform private.require_admin();
  if p_refund < 0 then
    raise exception 'INVALID_PRICE' using errcode = '22023';
  end if;
  perform 1 from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.roster_players
  set released_at = now(), released_via = 'admin'
  where team_id = p_team_id and player_id = p_player_id and released_at is null;
  if not found then
    raise exception 'NOT_IN_ROSTER' using errcode = 'P0002';
  end if;
  update public.teams set credits = credits + p_refund where id = p_team_id;
  insert into public.transactions (team_id, kind, player_out_id, player_out_price, credits_delta, note, created_by)
  values (p_team_id, 'admin_remove', p_player_id, p_refund, p_refund, p_note, auth.uid())
  returning id into v_tx;
  perform private.audit('roster.remove', 'teams', p_team_id::text,
    jsonb_build_object('player_id', p_player_id, 'refund', p_refund));
  return v_tx;
end;
$$;
revoke all on function public.admin_remove_player(uuid, integer, integer, text) from public;
grant execute on function public.admin_remove_player(uuid, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- rosters import
-- payload: {"teams": [{"name", "credits", "players": [{"player_id", "price_paid"}]}]}
-- Replaces the current roster of each listed team (initial assignment / full reset).
-- ---------------------------------------------------------------------------
create or replace function public.create_rosters_import(
  p_file_name text, p_file_path text, p_payload jsonb, p_stats jsonb
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform private.require_admin();
  if p_payload is null or jsonb_typeof(p_payload -> 'teams') is distinct from 'array' then
    raise exception 'INVALID_PAYLOAD' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload -> 'teams') > 100 then
    raise exception 'PAYLOAD_TOO_LARGE' using errcode = '22023';
  end if;
  insert into public.imports (kind, source, file_name, file_path, payload, stats, created_by)
  values ('rosters', 'manual', p_file_name, p_file_path, p_payload, coalesce(p_stats, '{}'::jsonb), auth.uid())
  returning id into v_id;
  perform private.audit('import.preview', 'imports', v_id::text, jsonb_build_object('kind', 'rosters'));
  return v_id;
end;
$$;
revoke all on function public.create_rosters_import(text, text, jsonb, jsonb) from public;
grant execute on function public.create_rosters_import(text, text, jsonb, jsonb) to authenticated;

create or replace function public.apply_rosters_import(p_import_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_import public.imports%rowtype;
  v_team jsonb;
  v_player jsonb;
  v_team_id uuid;
  v_name text;
  v_credits integer;
  v_teams_created integer := 0;
  v_teams_updated integer := 0;
  v_players integer := 0;
  v_released integer := 0;
  v_stats jsonb;
begin
  perform private.require_admin();

  select * into v_import from public.imports where id = p_import_id for update;
  if not found or v_import.kind <> 'rosters' then
    raise exception 'IMPORT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_import.status = 'failed' then
    raise exception 'IMPORT_DISCARDED' using errcode = '55000';
  end if;
  if v_import.status <> 'previewed' then
    raise exception 'IMPORT_ALREADY_APPLIED' using errcode = '55000';
  end if;

  for v_team in select * from jsonb_array_elements(v_import.payload -> 'teams') loop
    v_name := trim(v_team ->> 'name');
    v_credits := coalesce((v_team ->> 'credits')::integer, private.setting_int('initial_budget', 250));
    if v_credits < 0 then
      raise exception 'NEGATIVE_CREDITS' using errcode = '23514', detail = v_name;
    end if;

    select id into v_team_id from public.teams where lower(name) = lower(v_name) for update;
    if v_team_id is null then
      insert into public.teams (name, short_name, credits, swaps_used)
      values (v_name, private.make_short_name(v_name), v_credits, 0)
      returning id into v_team_id;
      v_teams_created := v_teams_created + 1;
    else
      update public.teams set credits = v_credits, swaps_used = 0 where id = v_team_id;
      v_teams_updated := v_teams_updated + 1;
      with released as (
        update public.roster_players
        set released_at = now(), released_via = 'admin'
        where team_id = v_team_id and released_at is null
        returning 1
      )
      select v_released + count(*) into v_released from released;
    end if;

    for v_player in select * from jsonb_array_elements(coalesce(v_team -> 'players', '[]'::jsonb)) loop
      if not exists (select 1 from public.players where id = (v_player ->> 'player_id')::integer) then
        raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002',
          detail = format('%s: player %s', v_name, v_player ->> 'player_id');
      end if;
      insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
      values (v_team_id, (v_player ->> 'player_id')::integer, coalesce((v_player ->> 'price_paid')::integer, 0), 'initial_import');
      v_players := v_players + 1;
    end loop;

    perform private.audit('roster.import', 'teams', v_team_id::text,
      jsonb_build_object('import_id', p_import_id, 'players', jsonb_array_length(coalesce(v_team -> 'players', '[]'::jsonb)), 'credits', v_credits));
  end loop;

  v_stats := coalesce(v_import.stats, '{}'::jsonb) || jsonb_build_object(
    'teams_created', v_teams_created, 'teams_updated', v_teams_updated,
    'players_assigned', v_players, 'players_released', v_released
  );
  update public.imports
  set status = 'applied', applied_at = now(), stats = v_stats, payload = null
  where id = p_import_id;
  perform private.audit('import.apply', 'imports', p_import_id::text, v_stats);
  return v_stats;
end;
$$;
revoke all on function public.apply_rosters_import(uuid) from public;
grant execute on function public.apply_rosters_import(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- roster composition helper (used by validation and the UI)
-- ---------------------------------------------------------------------------
create or replace function public.team_roster_summary(p_team_id uuid)
returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'count', count(*),
    'value', coalesce(sum(p.qt_a), 0),
    'paid', coalesce(sum(r.price_paid), 0),
    'by_role', jsonb_build_object(
      'P', count(*) filter (where p.role_classic = 'P'),
      'D', count(*) filter (where p.role_classic = 'D'),
      'C', count(*) filter (where p.role_classic = 'C'),
      'A', count(*) filter (where p.role_classic = 'A')
    ),
    'out_of_list', count(*) filter (where p.status = 'out_of_list')
  )
  from public.roster_players r
  join public.players p on p.id = r.player_id
  where r.team_id = p_team_id and r.released_at is null;
$$;
revoke all on function public.team_roster_summary(uuid) from public;
grant execute on function public.team_roster_summary(uuid) to authenticated;

-- ===== 20260909150000_market.sql =====
-- M4: market sessions, swaps, free swaps, reversals, close validation.
-- Rules: docs/SPEC.md §3, .claude/skills/market-rules/SKILL.md

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

-- The caller may act for a team if they own it or are an admin.
create or replace function private.can_manage_team(p_team_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select private.is_admin() or exists (
    select 1 from public.teams t
    join public.profiles p on p.user_id = t.owner_id
    where t.id = p_team_id and t.owner_id = auth.uid() and p.is_active
  );
$$;
revoke all on function private.can_manage_team(uuid) from public;

-- The session in which swaps are allowed right now, if any.
create or replace function public.current_market_session()
returns public.market_sessions
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select s from public.market_sessions s
  where s.status = 'open' and now() < s.closes_at
  limit 1;
$$;
revoke all on function public.current_market_session() from public;
grant execute on function public.current_market_session() to authenticated;

create or replace function private.price_for(p_rule text, p_qt_a integer, p_paid integer)
returns integer
language sql immutable
as $$
  select case when p_rule = 'price_paid' then p_paid else p_qt_a end;
$$;
revoke all on function private.price_for(text, integer, integer) from public;

-- ---------------------------------------------------------------------------
-- rate limiting (no external service: the database is the only shared state)
-- ---------------------------------------------------------------------------
insert into public.league_settings (key, value) values ('market_ops_per_minute', '5')
on conflict (key) do nothing;

create table private.rate_limits (
  user_id uuid not null,
  bucket text not null,
  window_start timestamptz not null default now(),
  hits integer not null default 0,
  primary key (user_id, bucket)
);
revoke all on private.rate_limits from public;

-- Fixed-window counter per user and bucket. Raises RATE_LIMITED past p_max hits.
create or replace function public.consume_rate_limit(p_bucket text, p_max integer, p_window_seconds integer)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_hits integer;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  insert into private.rate_limits (user_id, bucket, window_start, hits)
  values (auth.uid(), p_bucket, now(), 1)
  on conflict (user_id, bucket) do update
  set hits = case when private.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                  then 1 else private.rate_limits.hits + 1 end,
      window_start = case when private.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                          then now() else private.rate_limits.window_start end
  returning hits into v_hits;
  if v_hits > p_max then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
end;
$$;
revoke all on function public.consume_rate_limit(text, integer, integer) from public;
grant execute on function public.consume_rate_limit(text, integer, integer) to authenticated;

-- Committed market operations per team in the last minute (unbypassable throttle).
create or replace function private.check_market_throttle(p_team_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_max integer := private.setting_int('market_ops_per_minute', 5);
begin
  if (select count(*) from public.transactions
      where team_id = p_team_id and kind in ('swap', 'free_swap')
        and created_at > now() - interval '1 minute') >= v_max then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
end;
$$;
revoke all on function private.check_market_throttle(uuid) from public;

-- ---------------------------------------------------------------------------
-- sessions (admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_session(
  p_name text, p_opens_at timestamptz, p_closes_at timestamptz, p_extra_budget integer default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform private.require_admin();
  if p_closes_at <= p_opens_at then
    raise exception 'INVALID_WINDOW' using errcode = '22023';
  end if;
  insert into public.market_sessions (name, opens_at, closes_at, extra_budget, created_by)
  values (trim(p_name), p_opens_at, p_closes_at,
          coalesce(p_extra_budget, private.setting_int('session_extra_budget', 5)), auth.uid())
  returning id into v_id;
  perform private.audit('session.create', 'market_sessions', v_id::text,
    jsonb_build_object('name', p_name, 'opens_at', p_opens_at, 'closes_at', p_closes_at));
  return v_id;
end;
$$;
revoke all on function public.admin_create_session(text, timestamptz, timestamptz, integer) from public;
grant execute on function public.admin_create_session(text, timestamptz, timestamptz, integer) to authenticated;

create or replace function public.admin_update_session(
  p_id uuid, p_name text, p_opens_at timestamptz, p_closes_at timestamptz, p_extra_budget integer
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  perform private.require_admin();
  if p_closes_at <= p_opens_at then
    raise exception 'INVALID_WINDOW' using errcode = '22023';
  end if;
  select status into v_status from public.market_sessions where id = p_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status = 'closed' then
    raise exception 'SESSION_CLOSED' using errcode = '55000';
  end if;
  update public.market_sessions
  set name = trim(p_name), opens_at = p_opens_at, closes_at = p_closes_at,
      extra_budget = case when v_status = 'scheduled' then p_extra_budget else extra_budget end
  where id = p_id;
  perform private.audit('session.update', 'market_sessions', p_id::text,
    jsonb_build_object('name', p_name, 'opens_at', p_opens_at, 'closes_at', p_closes_at));
end;
$$;
revoke all on function public.admin_update_session(uuid, text, timestamptz, timestamptz, integer) from public;
grant execute on function public.admin_update_session(uuid, text, timestamptz, timestamptz, integer) to authenticated;

create or replace function public.admin_delete_session(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  delete from public.market_sessions where id = p_id and status = 'scheduled';
  if not found then
    raise exception 'SESSION_NOT_DELETABLE' using errcode = '55000';
  end if;
  perform private.audit('session.delete', 'market_sessions', p_id::text, null);
end;
$$;
revoke all on function public.admin_delete_session(uuid) from public;
grant execute on function public.admin_delete_session(uuid) to authenticated;

-- Opening: freeze the free-agent list and credit the extra budget exactly once.
create or replace function public.open_market_session(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.market_sessions%rowtype;
  v_free integer;
begin
  perform private.require_admin();
  select * into v_session from public.market_sessions where id = p_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'SESSION_NOT_SCHEDULED' using errcode = '55000';
  end if;
  if exists (select 1 from public.market_sessions where status = 'open') then
    raise exception 'ANOTHER_SESSION_OPEN' using errcode = '55000';
  end if;
  if v_session.closes_at <= now() then
    raise exception 'SESSION_ALREADY_EXPIRED' using errcode = '55000';
  end if;

  -- lock every team so the +5 and the snapshot happen against a quiet ledger
  perform 1 from public.teams for update;

  insert into public.session_free_agents (session_id, player_id)
  select p_id, id from public.free_agents
  on conflict do nothing;
  select count(*) into v_free from public.session_free_agents where session_id = p_id;

  if not v_session.extra_budget_applied and v_session.extra_budget > 0 then
    update public.teams set credits = credits + v_session.extra_budget;
    insert into public.transactions (team_id, session_id, kind, credits_delta, note, created_by)
    select id, p_id, 'admin_credits', v_session.extra_budget, 'Budget extra apertura sessione', auth.uid()
    from public.teams;
  end if;

  update public.market_sessions
  set status = 'open', opened_at = now(), extra_budget_applied = true,
      opens_at = least(opens_at, now())
  where id = p_id;

  perform private.audit('session.open', 'market_sessions', p_id::text,
    jsonb_build_object('free_agents', v_free, 'extra_budget', v_session.extra_budget));
end;
$$;
revoke all on function public.open_market_session(uuid) from public;
grant execute on function public.open_market_session(uuid) to authenticated;

-- Roster validation used by the closing report and the UI.
create or replace function public.validate_rosters()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_comp jsonb := coalesce(private.setting_json('roster_composition'), '{"P":3,"D":7,"C":7,"A":6}'::jsonb);
  v_target integer := (v_comp ->> 'P')::int + (v_comp ->> 'D')::int + (v_comp ->> 'C')::int + (v_comp ->> 'A')::int;
  v_report jsonb;
begin
  perform private.require_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
    'team_id', t.id, 'team', t.name, 'credits', t.credits, 'swaps_used', t.swaps_used,
    'count', s.cnt, 'by_role', s.by_role, 'out_of_list', s.ool,
    'ok', s.cnt = v_target
          and (s.by_role ->> 'P')::int = (v_comp ->> 'P')::int
          and (s.by_role ->> 'D')::int = (v_comp ->> 'D')::int
          and (s.by_role ->> 'C')::int = (v_comp ->> 'C')::int
          and (s.by_role ->> 'A')::int = (v_comp ->> 'A')::int
          and s.ool = 0
  ) order by t.name), '[]'::jsonb)
  into v_report
  from public.teams t
  cross join lateral (
    select count(*) as cnt,
           count(*) filter (where p.status = 'out_of_list') as ool,
           jsonb_build_object(
             'P', count(*) filter (where p.role_classic = 'P'),
             'D', count(*) filter (where p.role_classic = 'D'),
             'C', count(*) filter (where p.role_classic = 'C'),
             'A', count(*) filter (where p.role_classic = 'A')) as by_role
    from public.roster_players r
    join public.players p on p.id = r.player_id
    where r.team_id = t.id and r.released_at is null
  ) s;
  return jsonb_build_object('composition', v_comp, 'teams', v_report,
    'invalid', (select count(*) from jsonb_array_elements(v_report) e where not (e ->> 'ok')::boolean));
end;
$$;
revoke all on function public.validate_rosters() from public;
grant execute on function public.validate_rosters() to authenticated;

create or replace function public.close_market_session(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_report jsonb;
begin
  perform private.require_admin();
  select status into v_status from public.market_sessions where id = p_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
  end if;
  v_report := public.validate_rosters();
  update public.market_sessions
  set status = 'closed', closed_at = now(),
      closes_at = greatest(least(closes_at, now()), opens_at + interval '1 second'),
      validation_report = v_report
  where id = p_id;
  perform private.audit('session.close', 'market_sessions', p_id::text,
    jsonb_build_object('invalid', v_report -> 'invalid'));
  return v_report;
end;
$$;
revoke all on function public.close_market_session(uuid) from public;
grant execute on function public.close_market_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- swap (out + in, same role) during an open session
-- ---------------------------------------------------------------------------
create or replace function public.swap_player(p_team_id uuid, p_player_out integer, p_player_in integer)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_team public.teams%rowtype;
  v_session public.market_sessions;
  v_out public.players%rowtype;
  v_in public.players%rowtype;
  v_paid integer;
  v_refund integer;
  v_cost integer;
  v_limit integer := private.setting_int('season_swap_limit', 20);
  v_rule text := coalesce(private.setting_json('sale_price_rule') #>> '{}', 'current_quotation');
  v_tx uuid;
begin
  if not private.can_manage_team(p_team_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_player_out = p_player_in then
    raise exception 'SAME_PLAYER' using errcode = '22023';
  end if;

  select * into v_team from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.check_market_throttle(p_team_id);

  -- shared lock: a concurrent close_market_session (for update) waits for us,
  -- and swaps started after the close see the new status
  select s.* into v_session from public.market_sessions s
  where s.status = 'open' and now() < s.closes_at
  limit 1 for share;
  if v_session.id is null then
    raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
  end if;

  select r.price_paid into v_paid
  from public.roster_players r
  where r.team_id = p_team_id and r.player_id = p_player_out and r.released_at is null;
  if not found then
    raise exception 'NOT_IN_ROSTER' using errcode = 'P0002';
  end if;
  select * into v_out from public.players where id = p_player_out;
  if v_out.status <> 'active' then
    raise exception 'USE_FREE_SWAP' using errcode = '22023';
  end if;
  select * into v_in from public.players where id = p_player_in;
  if v_in.id is null or v_in.status <> 'active' then
    raise exception 'PLAYER_NOT_AVAILABLE' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.session_free_agents where session_id = v_session.id and player_id = p_player_in) then
    raise exception 'NOT_FREE_AGENT' using errcode = '22023';
  end if;
  if exists (select 1 from public.roster_players where team_id = p_team_id and player_id = p_player_in and released_at is null) then
    raise exception 'ALREADY_IN_ROSTER' using errcode = '23505';
  end if;
  if v_in.role_classic <> v_out.role_classic then
    raise exception 'ROLE_MISMATCH' using errcode = '22023';
  end if;
  if v_team.swaps_used >= v_limit then
    raise exception 'SWAP_LIMIT_REACHED' using errcode = '22023';
  end if;

  v_refund := private.price_for(v_rule, v_out.qt_a, v_paid);
  v_cost := v_in.qt_a;
  if v_team.credits + v_refund - v_cost < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;

  update public.roster_players set released_at = now(), released_via = 'swap'
  where team_id = p_team_id and player_id = p_player_out and released_at is null;
  insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
  values (p_team_id, p_player_in, v_cost, 'swap');
  update public.teams
  set credits = credits + v_refund - v_cost, swaps_used = swaps_used + 1
  where id = p_team_id;

  insert into public.transactions (team_id, session_id, kind, player_out_id, player_out_price,
    player_in_id, player_in_price, credits_delta, counts_toward_limit, created_by)
  values (p_team_id, v_session.id, 'swap', p_player_out, v_refund, p_player_in, v_cost,
    v_refund - v_cost, true, auth.uid())
  returning id into v_tx;
  perform private.audit('market.swap', 'transactions', v_tx::text,
    jsonb_build_object('team_id', p_team_id, 'out', p_player_out, 'in', p_player_in, 'refund', v_refund, 'cost', v_cost));
  return v_tx;
end;
$$;
revoke all on function public.swap_player(uuid, integer, integer) from public;
grant execute on function public.swap_player(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- free swap: replace a player who left Serie A, any time, not counted
-- ---------------------------------------------------------------------------
create or replace function public.free_swap_player(p_team_id uuid, p_player_out integer, p_player_in integer)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_team public.teams%rowtype;
  v_session public.market_sessions;
  v_out public.players%rowtype;
  v_in public.players%rowtype;
  v_paid integer;
  v_refund integer;
  v_cost integer;
  v_rule text := coalesce(private.setting_json('free_swap_refund_rule') #>> '{}', 'price_paid');
  v_tx uuid;
begin
  if not private.can_manage_team(p_team_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_team from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  select r.price_paid into v_paid
  from public.roster_players r
  where r.team_id = p_team_id and r.player_id = p_player_out and r.released_at is null;
  if not found then
    raise exception 'NOT_IN_ROSTER' using errcode = 'P0002';
  end if;
  select * into v_out from public.players where id = p_player_out;
  if v_out.status <> 'out_of_list' then
    raise exception 'NOT_OUT_OF_LIST' using errcode = '22023';
  end if;
  perform private.check_market_throttle(p_team_id);
  -- lock the incoming player: "free right now" must be exclusive between concurrent free swaps
  select * into v_in from public.players where id = p_player_in for update;
  if v_in.id is null or v_in.status <> 'active' then
    raise exception 'PLAYER_NOT_AVAILABLE' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.free_agents where id = p_player_in) then
    raise exception 'NOT_FREE_AGENT' using errcode = '22023';
  end if;
  if v_in.role_classic <> v_out.role_classic then
    raise exception 'ROLE_MISMATCH' using errcode = '22023';
  end if;

  v_refund := private.price_for(v_rule, v_out.qt_a, v_paid);
  v_cost := v_in.qt_a;
  if v_team.credits + v_refund - v_cost < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;

  v_session := public.current_market_session();

  update public.roster_players set released_at = now(), released_via = 'free_swap'
  where team_id = p_team_id and player_id = p_player_out and released_at is null;
  insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
  values (p_team_id, p_player_in, v_cost, 'free_swap');
  update public.teams set credits = credits + v_refund - v_cost where id = p_team_id;

  insert into public.transactions (team_id, session_id, kind, player_out_id, player_out_price,
    player_in_id, player_in_price, credits_delta, counts_toward_limit, created_by)
  values (p_team_id, v_session.id, 'free_swap', p_player_out, v_refund, p_player_in, v_cost,
    v_refund - v_cost, false, auth.uid())
  returning id into v_tx;
  perform private.audit('market.free_swap', 'transactions', v_tx::text,
    jsonb_build_object('team_id', p_team_id, 'out', p_player_out, 'in', p_player_in, 'refund', v_refund, 'cost', v_cost));
  return v_tx;
end;
$$;
revoke all on function public.free_swap_player(uuid, integer, integer) from public;
grant execute on function public.free_swap_player(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- reversal (admin): the inverse operation, never a delete
-- ---------------------------------------------------------------------------
create or replace function public.reverse_transaction(p_tx_id uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_team public.teams%rowtype;
  v_paid integer;
  v_rev uuid;
begin
  perform private.require_admin();
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v_tx from public.transactions where id = p_tx_id;
  if not found then
    raise exception 'TX_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_team from public.teams where id = v_tx.team_id for update;
  if v_tx.kind = 'reversal' then
    raise exception 'CANNOT_REVERSE_REVERSAL' using errcode = '55000';
  end if;
  if exists (select 1 from public.transactions where reversal_of = p_tx_id) then
    raise exception 'ALREADY_REVERSED' using errcode = '55000';
  end if;

  if v_team.credits - v_tx.credits_delta < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;

  -- undo the incoming player
  if v_tx.player_in_id is not null then
    update public.roster_players set released_at = now(), released_via = 'reversal'
    where team_id = v_tx.team_id and player_id = v_tx.player_in_id and released_at is null;
    if not found then
      raise exception 'IN_PLAYER_NO_LONGER_IN_ROSTER' using errcode = '55000';
    end if;
  end if;
  -- restore the outgoing player at the price they had before
  if v_tx.player_out_id is not null then
    if exists (select 1 from public.roster_players where team_id = v_tx.team_id and player_id = v_tx.player_out_id and released_at is null) then
      raise exception 'OUT_PLAYER_ALREADY_IN_ROSTER' using errcode = '55000';
    end if;
    select price_paid into v_paid from public.roster_players
    where team_id = v_tx.team_id and player_id = v_tx.player_out_id
      and released_at is not null and released_at <= v_tx.created_at
    order by released_at desc limit 1;
    insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
    values (v_tx.team_id, v_tx.player_out_id, coalesce(v_paid, v_tx.player_out_price, 0), 'reversal');
  end if;

  update public.teams
  set credits = credits - v_tx.credits_delta,
      swaps_used = case when v_tx.counts_toward_limit then greatest(swaps_used - 1, 0) else swaps_used end
  where id = v_tx.team_id;

  insert into public.transactions (team_id, session_id, kind, player_out_id, player_out_price,
    player_in_id, player_in_price, credits_delta, counts_toward_limit, note, reversal_of, created_by)
  values (v_tx.team_id, v_tx.session_id, 'reversal', v_tx.player_in_id, v_tx.player_in_price,
    v_tx.player_out_id, v_tx.player_out_price, -v_tx.credits_delta, false, trim(p_reason), p_tx_id, auth.uid())
  returning id into v_rev;
  perform private.audit('market.reverse', 'transactions', v_rev::text,
    jsonb_build_object('reversal_of', p_tx_id, 'reason', trim(p_reason)));
  return v_rev;
end;
$$;
revoke all on function public.reverse_transaction(uuid, text) from public;
grant execute on function public.reverse_transaction(uuid, text) to authenticated;

-- ===== 20260909160000_admin.sql =====
-- M6: admin panel support — user directory with emails (admin only), notification
-- recipients, settings helpers.

-- ---------------------------------------------------------------------------
-- profiles.email: copied from auth.users; readable only by admins (column grant)
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists email text;

update public.profiles p set email = u.email
from auth.users u where u.id = p.user_id and p.email is distinct from u.email;

create or replace function private.sync_profile_email()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles set email = new.email where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_email on auth.users;
create trigger trg_on_auth_user_email
after update of email on auth.users
for each row execute function private.sync_profile_email();

-- handle_new_user now stores the email too
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
  if not private.league_code_matches(new.raw_user_meta_data ->> 'league_code') then
    raise exception 'INVALID_LEAGUE_CODE' using errcode = '42501';
  end if;

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

  insert into public.profiles (user_id, display_name, role, email)
  values (new.id, v_name, v_role, new.email);
  return new;
end;
$$;

-- Members read the directory without emails; admins get emails through a function.
revoke select on public.profiles from authenticated;
grant select (user_id, display_name, role, is_active, created_at, updated_at)
  on public.profiles to authenticated;

create or replace function public.admin_list_users()
returns table (
  user_id uuid, display_name text, email text, role text, is_active boolean,
  created_at timestamptz, team_id uuid, team_name text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.user_id, p.display_name, p.email, p.role, p.is_active, p.created_at, t.id, t.name
  from public.profiles p
  left join public.teams t on t.owner_id = p.user_id
  where private.is_admin()
  order by p.display_name;
$$;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

-- Recipients for league emails (active members with an email). Admin only.
create or replace function public.admin_notification_recipients()
returns table (email text, display_name text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.email, p.display_name
  from public.profiles p
  where private.is_admin() and p.is_active and p.email is not null;
$$;
revoke all on function public.admin_notification_recipients() from public;
grant execute on function public.admin_notification_recipients() to authenticated;

-- ---------------------------------------------------------------------------
-- audit log reader with names (admin only)
-- ---------------------------------------------------------------------------
create or replace function public.admin_audit_log(p_limit integer default 200)
returns table (
  id bigint, created_at timestamptz, user_id uuid, display_name text,
  action text, entity text, entity_id text, payload jsonb
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.id, a.created_at, a.user_id, p.display_name, a.action, a.entity, a.entity_id, a.payload
  from public.audit_log a
  left join public.profiles p on p.user_id = a.user_id
  where private.is_admin()
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;
revoke all on function public.admin_audit_log(integer) from public;
grant execute on function public.admin_audit_log(integer) to authenticated;

-- Email notification log (what was sent, to how many, outcome).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  subject text not null,
  recipients integer not null default 0,
  status text not null check (status in ('sent', 'partial', 'failed', 'skipped')),
  detail text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
create policy "notifications: admin read" on public.notifications for select to authenticated
  using (private.is_admin());

create or replace function public.log_notification(
  p_kind text, p_subject text, p_recipients integer, p_status text, p_detail text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  if p_recipients < 0 or p_status not in ('sent', 'partial', 'failed', 'skipped') then
    raise exception 'INVALID_NOTIFICATION' using errcode = '22023';
  end if;
  insert into public.notifications (kind, subject, recipients, status, detail, created_by)
  values (p_kind, p_subject, p_recipients, p_status, left(p_detail, 500), auth.uid());
end;
$$;
revoke all on function public.log_notification(text, text, integer, text, text) from public;
grant execute on function public.log_notification(text, text, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- M1 user functions now write the audit log too
-- ---------------------------------------------------------------------------
create or replace function public.set_user_role(target_user uuid, new_role text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
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
  perform private.audit('user.role', 'profiles', target_user::text, jsonb_build_object('role', new_role));
end;
$$;

create or replace function public.set_user_active(target_user uuid, active boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  if target_user = auth.uid() and not active then
    raise exception 'CANNOT_DEACTIVATE_SELF' using errcode = '22023';
  end if;
  update public.profiles set is_active = active where user_id = target_user;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.audit('user.active', 'profiles', target_user::text, jsonb_build_object('active', active));
end;
$$;

create or replace function public.update_my_display_name(new_name text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := left(trim(new_name), 40);
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'INVALID_NAME' using errcode = '22023';
  end if;
  update public.profiles set display_name = v_name where user_id = auth.uid();
  perform private.audit('user.rename', 'profiles', auth.uid()::text, jsonb_build_object('name', v_name));
end;
$$;

-- ---------------------------------------------------------------------------
-- Rate limits are defined here, not by the caller (QA finding: a manager could
-- pass its own limits to consume_rate_limit through a direct RPC).
-- ---------------------------------------------------------------------------
drop function if exists public.consume_rate_limit(text, integer, integer);

create or replace function public.consume_rate_limit(p_bucket text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_max integer;
  v_window integer;
  v_hits integer;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  case p_bucket
    when 'market' then v_max := 10; v_window := 60;
    when 'import' then v_max := 10; v_window := 600;
    when 'export' then v_max := 10; v_window := 600;
    when 'email'  then v_max := 5;  v_window := 3600;
    when 'admin'  then v_max := 60; v_window := 60;
    else raise exception 'UNKNOWN_BUCKET' using errcode = '22023';
  end case;
  insert into private.rate_limits (user_id, bucket, window_start, hits)
  values (auth.uid(), p_bucket, now(), 1)
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
revoke all on function public.consume_rate_limit(text) from public;
grant execute on function public.consume_rate_limit(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin roster edits and roster imports are not allowed while a session is
-- open: they would bypass the free-agent snapshot and the ledger (QA finding).
-- ---------------------------------------------------------------------------
create or replace function private.assert_no_open_session()
returns void
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.market_sessions where status = 'open') then
    raise exception 'SESSION_OPEN' using errcode = '55000';
  end if;
end;
$$;
revoke all on function private.assert_no_open_session() from public;

create or replace function public.admin_assign_player(p_team_id uuid, p_player_id integer, p_price integer, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_credits integer;
  v_tx uuid;
begin
  perform private.require_admin();
  perform private.assert_no_open_session();
  if p_price < 0 then
    raise exception 'INVALID_PRICE' using errcode = '22023';
  end if;
  select credits into v_credits from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.roster_players
    where team_id = p_team_id and player_id = p_player_id and released_at is null
  ) then
    raise exception 'ALREADY_IN_ROSTER' using errcode = '23505';
  end if;
  if v_credits - p_price < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;

  insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
  values (p_team_id, p_player_id, p_price, 'admin');
  update public.teams set credits = credits - p_price where id = p_team_id;
  insert into public.transactions (team_id, kind, player_in_id, player_in_price, credits_delta, note, created_by)
  values (p_team_id, 'admin_assign', p_player_id, p_price, -p_price, p_note, auth.uid())
  returning id into v_tx;
  perform private.audit('roster.assign', 'teams', p_team_id::text,
    jsonb_build_object('player_id', p_player_id, 'price', p_price));
  return v_tx;
end;
$$;

create or replace function public.admin_remove_player(p_team_id uuid, p_player_id integer, p_refund integer default 0, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tx uuid;
begin
  perform private.require_admin();
  perform private.assert_no_open_session();
  if p_refund < 0 then
    raise exception 'INVALID_PRICE' using errcode = '22023';
  end if;
  perform 1 from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.roster_players
  set released_at = now(), released_via = 'admin'
  where team_id = p_team_id and player_id = p_player_id and released_at is null;
  if not found then
    raise exception 'NOT_IN_ROSTER' using errcode = 'P0002';
  end if;
  update public.teams set credits = credits + p_refund where id = p_team_id;
  insert into public.transactions (team_id, kind, player_out_id, player_out_price, credits_delta, note, created_by)
  values (p_team_id, 'admin_remove', p_player_id, p_refund, p_refund, p_note, auth.uid())
  returning id into v_tx;
  perform private.audit('roster.remove', 'teams', p_team_id::text,
    jsonb_build_object('player_id', p_player_id, 'refund', p_refund));
  return v_tx;
end;
$$;

create or replace function public.apply_rosters_import(p_import_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_import public.imports%rowtype;
  v_team jsonb;
  v_player jsonb;
  v_team_id uuid;
  v_name text;
  v_credits integer;
  v_teams_created integer := 0;
  v_teams_updated integer := 0;
  v_players integer := 0;
  v_released integer := 0;
  v_stats jsonb;
begin
  perform private.require_admin();
  perform private.assert_no_open_session();

  select * into v_import from public.imports where id = p_import_id for update;
  if not found or v_import.kind <> 'rosters' then
    raise exception 'IMPORT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_import.status = 'failed' then
    raise exception 'IMPORT_DISCARDED' using errcode = '55000';
  end if;
  if v_import.status <> 'previewed' then
    raise exception 'IMPORT_ALREADY_APPLIED' using errcode = '55000';
  end if;

  for v_team in select * from jsonb_array_elements(v_import.payload -> 'teams') loop
    v_name := trim(v_team ->> 'name');
    v_credits := coalesce((v_team ->> 'credits')::integer, private.setting_int('initial_budget', 250));
    if v_credits < 0 then
      raise exception 'NEGATIVE_CREDITS' using errcode = '23514', detail = v_name;
    end if;

    select id into v_team_id from public.teams where lower(name) = lower(v_name) for update;
    if v_team_id is null then
      insert into public.teams (name, short_name, credits, swaps_used)
      values (v_name, private.make_short_name(v_name), v_credits, 0)
      returning id into v_team_id;
      v_teams_created := v_teams_created + 1;
    else
      update public.teams set credits = v_credits, swaps_used = 0 where id = v_team_id;
      v_teams_updated := v_teams_updated + 1;
      with released as (
        update public.roster_players
        set released_at = now(), released_via = 'admin'
        where team_id = v_team_id and released_at is null
        returning 1
      )
      select v_released + count(*) into v_released from released;
    end if;

    for v_player in select * from jsonb_array_elements(coalesce(v_team -> 'players', '[]'::jsonb)) loop
      if not exists (select 1 from public.players where id = (v_player ->> 'player_id')::integer) then
        raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002',
          detail = format('%s: player %s', v_name, v_player ->> 'player_id');
      end if;
      insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
      values (v_team_id, (v_player ->> 'player_id')::integer, coalesce((v_player ->> 'price_paid')::integer, 0), 'initial_import');
      v_players := v_players + 1;
    end loop;

    perform private.audit('roster.import', 'teams', v_team_id::text,
      jsonb_build_object('import_id', p_import_id, 'players', jsonb_array_length(coalesce(v_team -> 'players', '[]'::jsonb)), 'credits', v_credits));
  end loop;

  v_stats := coalesce(v_import.stats, '{}'::jsonb) || jsonb_build_object(
    'teams_created', v_teams_created, 'teams_updated', v_teams_updated,
    'players_assigned', v_players, 'players_released', v_released
  );
  update public.imports
  set status = 'applied', applied_at = now(), stats = v_stats, payload = null
  where id = p_import_id;
  perform private.audit('import.apply', 'imports', p_import_id::text, v_stats);
  return v_stats;
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings are validated by key: a malformed value would silently break the
-- market functions and the closing report (QA finding).
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_int integer;
begin
  perform private.require_admin();
  if p_value is null then
    raise exception 'INVALID_SETTING' using errcode = '22023', detail = p_key;
  end if;

  if p_key in ('initial_budget', 'season_swap_limit', 'session_extra_budget',
               'market_ops_per_minute', 'quotation_change_alert_threshold', 'sync_hour') then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^[0-9]+$' then
      raise exception 'INVALID_SETTING' using errcode = '22023', detail = p_key;
    end if;
    v_int := (p_value #>> '{}')::integer;
    if (p_key = 'market_ops_per_minute' and v_int < 1)
       or (p_key = 'sync_hour' and v_int > 23)
       or v_int > 100000 then
      raise exception 'INVALID_SETTING' using errcode = '22023', detail = p_key;
    end if;
  elsif p_key = 'roster_composition' then
    if jsonb_typeof(p_value) <> 'object' then
      raise exception 'INVALID_SETTING' using errcode = '22023', detail = p_key;
    end if;
    for v_int in select 1 from unnest(array['P', 'D', 'C', 'A']) r
      where jsonb_typeof(p_value -> r) is distinct from 'number'
         or (p_value ->> r) !~ '^[0-9]+$' or (p_value ->> r)::integer > 50
    loop
      raise exception 'INVALID_SETTING' using errcode = '22023', detail = p_key;
    end loop;
    if (p_value ->> 'P')::integer + (p_value ->> 'D')::integer
       + (p_value ->> 'C')::integer + (p_value ->> 'A')::integer = 0 then
      raise exception 'INVALID_SETTING' using errcode = '22023', detail = p_key;
    end if;
  elsif p_key = 'league_code' then
    if jsonb_typeof(p_value) <> 'string' then
      raise exception 'INVALID_SETTING' using errcode = '22023', detail = p_key;
    end if;
    p_value := to_jsonb(upper(trim(p_value #>> '{}')));
    if char_length(p_value #>> '{}') not between 4 and 64
       or (p_value #>> '{}') !~ '^[A-Z0-9-]+$' then
      raise exception 'INVALID_SETTING' using errcode = '22023', detail = p_key;
    end if;
  elsif p_key in ('sale_price_rule', 'free_swap_refund_rule') then
    if jsonb_typeof(p_value) <> 'string'
       or (p_value #>> '{}') not in ('current_quotation', 'price_paid') then
      raise exception 'INVALID_SETTING' using errcode = '22023', detail = p_key;
    end if;
  elsif p_key in ('sync_enabled', 'notifications_enabled') then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception 'INVALID_SETTING' using errcode = '22023', detail = p_key;
    end if;
  elsif p_key = 'import_min_rows_ratio' then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0 and 1 then
      raise exception 'INVALID_SETTING' using errcode = '22023', detail = p_key;
    end if;
  elsif p_key = 'bootstrap_admin_email' then
    -- Seed-time only: once an admin exists, promotions go through set_user_role
    -- (audited as user.role), never through a quiet signup rule.
    if jsonb_typeof(p_value) <> 'string'
       or exists (select 1 from public.profiles where role = 'admin') then
      raise exception 'INVALID_SETTING' using errcode = '22023', detail = p_key;
    end if;
  else
    raise exception 'UNKNOWN_SETTING' using errcode = '22023', detail = p_key;
  end if;

  insert into public.league_settings (key, value, updated_by)
  values (p_key, p_value, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  perform private.audit('setting.update', 'league_settings', p_key,
    case when p_key = 'league_code' then null else jsonb_build_object('value', p_value) end);
end;
$$;

insert into public.league_settings (key, value) values ('notifications_enabled', 'true')
on conflict (key) do nothing;

-- Team short names are shown everywhere as the team identity: keep them unique.
create unique index if not exists teams_short_name_key on public.teams (short_name);

-- ===== 20260909170000_hardening.sql =====
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

-- ===== 20260909180000_anon_function_grants.sql =====
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

-- ===== 20260909190000_roster_placeholders.sql =====
-- Roster import: names that are no longer in the listone (players who left Serie A
-- after the auction) can be imported as out-of-list "placeholder" players, so the
-- manager releases them with a free swap and gets the price paid back (league rule
-- "fuori lista"). Placeholders use negative ids: they never collide with Fantacalcio
-- ids and are never touched by quotations imports (which upsert by id).

create sequence if not exists private.placeholder_player_id_seq
  as integer increment by -1 minvalue -2147483647 maxvalue -1 start with -1;

create or replace function private.ensure_placeholder_player(p_name text, p_role text)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_name text := trim(p_name);
  v_id integer;
begin
  if v_name = '' or v_name is null then
    raise exception 'PLACEHOLDER_NAME' using errcode = '22023';
  end if;
  if p_role not in ('P', 'D', 'C', 'A') then
    raise exception 'PLACEHOLDER_ROLE' using errcode = '22023', detail = v_name;
  end if;
  -- Re-importing the same file must reuse the placeholder, not create a twin.
  select id into v_id from public.players
  where id < 0 and lower(name) = lower(v_name) and role_classic = p_role
  order by id desc limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff, status, out_of_list_at)
  values (nextval('private.placeholder_player_id_seq'), v_name, 'Fuori Serie A', p_role, 0, 0, 0,
          'out_of_list', now())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.ensure_placeholder_player(text, text) from public;

create or replace function public.apply_rosters_import(p_import_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_import public.imports%rowtype;
  v_team jsonb;
  v_player jsonb;
  v_team_id uuid;
  v_name text;
  v_credits integer;
  v_player_id integer;
  v_teams_created integer := 0;
  v_teams_updated integer := 0;
  v_players integer := 0;
  v_placeholders integer := 0;
  v_released integer := 0;
  v_stats jsonb;
begin
  perform private.require_admin();
  perform private.assert_no_open_session();

  select * into v_import from public.imports where id = p_import_id for update;
  if not found or v_import.kind <> 'rosters' then
    raise exception 'IMPORT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_import.status = 'failed' then
    raise exception 'IMPORT_DISCARDED' using errcode = '55000';
  end if;
  if v_import.status <> 'previewed' then
    raise exception 'IMPORT_ALREADY_APPLIED' using errcode = '55000';
  end if;

  for v_team in select * from jsonb_array_elements(v_import.payload -> 'teams') loop
    v_name := trim(v_team ->> 'name');
    v_credits := coalesce((v_team ->> 'credits')::integer, private.setting_int('initial_budget', 250));
    if v_credits < 0 then
      raise exception 'NEGATIVE_CREDITS' using errcode = '23514', detail = v_name;
    end if;

    select id into v_team_id from public.teams where lower(name) = lower(v_name) for update;
    if v_team_id is null then
      insert into public.teams (name, short_name, credits, swaps_used)
      values (v_name, private.make_short_name(v_name), v_credits, 0)
      returning id into v_team_id;
      v_teams_created := v_teams_created + 1;
    else
      update public.teams set credits = v_credits, swaps_used = 0 where id = v_team_id;
      v_teams_updated := v_teams_updated + 1;
      with released as (
        update public.roster_players
        set released_at = now(), released_via = 'admin'
        where team_id = v_team_id and released_at is null
        returning 1
      )
      select v_released + count(*) into v_released from released;
    end if;

    for v_player in select * from jsonb_array_elements(coalesce(v_team -> 'players', '[]'::jsonb)) loop
      if v_player ? 'placeholder' then
        v_player_id := private.ensure_placeholder_player(
          v_player #>> '{placeholder,name}', v_player #>> '{placeholder,role}');
        v_placeholders := v_placeholders + 1;
      else
        v_player_id := (v_player ->> 'player_id')::integer;
        if not exists (select 1 from public.players where id = v_player_id) then
          raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002',
            detail = format('%s: player %s', v_name, v_player_id);
        end if;
      end if;
      insert into public.roster_players (team_id, player_id, price_paid, acquired_via)
      values (v_team_id, v_player_id, coalesce((v_player ->> 'price_paid')::integer, 0), 'initial_import');
      v_players := v_players + 1;
    end loop;

    perform private.audit('roster.import', 'teams', v_team_id::text,
      jsonb_build_object('import_id', p_import_id, 'players', jsonb_array_length(coalesce(v_team -> 'players', '[]'::jsonb)), 'credits', v_credits));
  end loop;

  v_stats := coalesce(v_import.stats, '{}'::jsonb) || jsonb_build_object(
    'teams_created', v_teams_created, 'teams_updated', v_teams_updated,
    'players_assigned', v_players, 'players_released', v_released,
    'placeholders', v_placeholders
  );
  update public.imports
  set status = 'applied', applied_at = now(), stats = v_stats, payload = null
  where id = p_import_id;
  perform private.audit('import.apply', 'imports', p_import_id::text, v_stats);
  return v_stats;
end;
$$;
revoke all on function public.apply_rosters_import(uuid) from public, anon;
grant execute on function public.apply_rosters_import(uuid) to authenticated;

