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
  if jsonb_typeof(p_payload -> 'rows') <> 'array' then
    raise exception 'INVALID_PAYLOAD' using errcode = '22023';
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
  if v_import.status <> 'previewed' then
    raise exception 'IMPORT_ALREADY_APPLIED' using errcode = '55000';
  end if;

  -- Several imports may run in one transaction (tests), so never assume a clean session.
  drop table if exists tmp_rows;
  create temp table tmp_rows on commit drop as
  select
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

  select count(*) into v_rows from tmp_rows;
  select count(*) into v_active_before from public.players where status = 'active';
  if v_active_before > 0 and v_rows < v_active_before * v_min_ratio then
    raise exception 'IMPORT_TOO_SMALL' using errcode = '22023',
      detail = format('%s rows vs %s active players', v_rows, v_active_before);
  end if;

  -- notable quotation changes (before upsert)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'from', p.qt_a, 'to', t.qt_a) order by abs(t.qt_a - p.qt_a) desc), '[]'::jsonb)
  into v_notable
  from tmp_rows t join public.players p on p.id = t.id
  where abs(t.qt_a - p.qt_a) >= v_threshold;

  select count(*) into v_new from tmp_rows t where not exists (select 1 from public.players p where p.id = t.id);
  select count(*) into v_revived from tmp_rows t join public.players p on p.id = t.id where p.status = 'out_of_list';
  select count(*) into v_updated
  from tmp_rows t join public.players p on p.id = t.id
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
  from tmp_rows
  on conflict (id) do update set
    name = excluded.name, team = excluded.team, role_classic = excluded.role_classic,
    role_mantra = excluded.role_mantra, qt_a = excluded.qt_a, qt_i = excluded.qt_i, diff = excluded.diff,
    qt_a_m = excluded.qt_a_m, qt_i_m = excluded.qt_i_m, diff_m = excluded.diff_m,
    fvm = excluded.fvm, fvm_m = excluded.fvm_m, status = 'active', out_of_list_at = null;

  -- players missing from the file, or listed as ceded, leave the list (never deleted)
  with gone as (
    update public.players p
    set status = 'out_of_list', out_of_list_at = coalesce(p.out_of_list_at, now())
    where p.status = 'active'
      and (
        not exists (select 1 from tmp_rows t where t.id = p.id)
        or p.id in (select (x #>> '{}')::integer from jsonb_array_elements(coalesce(v_import.payload -> 'out_of_list_ids', '[]'::jsonb)) x)
      )
    returning p.id
  )
  select count(*) into v_out from gone;

  insert into public.player_quotations (import_id, player_id, qt_a, qt_i, diff, qt_a_m, qt_i_m, diff_m, fvm, fvm_m)
  select p_import_id, id, qt_a, qt_i, diff, qt_a_m, qt_i_m, diff_m, fvm, fvm_m from tmp_rows;

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
