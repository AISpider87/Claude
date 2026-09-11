-- M15: automatic availability/lineup feed (API-Football).
--
-- The admin's word wins: a `player_status` row written by hand (origin =
-- 'manual') is never touched by the feed. Feed rows (origin = 'feed') are
-- replaced at every run and disappear when the provider stops reporting them.
-- Lineups are volatile by nature: they are replaced per fixture and pruned.
--
-- Every write goes through `public.sync_availability(jsonb)`, callable by the
-- service role only (the cron job / the admin's "Aggiorna adesso", which runs
-- through the service client). Conventions: .claude/skills/supabase-conventions.

-- ---------------------------------------------------------------------------
-- player_status: where the row comes from
-- ---------------------------------------------------------------------------
alter table public.player_status
  add column if not exists origin text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'player_status_origin_check'
  ) then
    alter table public.player_status
      add constraint player_status_origin_check check (origin in ('manual', 'feed'));
  end if;
end $$;

create index if not exists idx_player_status_origin on public.player_status (origin, updated_at desc);

-- `private.set_player_status` is the admin path: it must always stamp 'manual',
-- so a hand-made row survives the next feed run.
create or replace function private.set_player_status(
  p_player_id integer, p_kind text, p_note text, p_source_name text, p_source_url text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_kind = 'ok' then
    delete from public.player_status where player_id = p_player_id;
    return;
  end if;
  if p_kind not in ('injured', 'doubtful', 'suspended', 'unavailable') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  insert into public.player_status (player_id, kind, note, source_name, source_url, origin, updated_by, updated_at)
  values (p_player_id, p_kind, left(nullif(trim(p_note), ''), 200), left(nullif(trim(p_source_name), ''), 60),
          nullif(trim(p_source_url), ''), 'manual', auth.uid(), now())
  on conflict (player_id) do update
    set kind = excluded.kind, note = excluded.note, source_name = excluded.source_name,
        source_url = excluded.source_url, origin = 'manual', updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;
revoke all on function private.set_player_status(integer, text, text, text, text) from public;

-- ---------------------------------------------------------------------------
-- player_lineup_status: "titolare / in panchina" for the imminent fixture
-- ---------------------------------------------------------------------------
create table if not exists public.player_lineup_status (
  player_id integer primary key references public.players (id) on delete cascade,
  state text not null check (state in ('starting', 'bench')),
  fixture_id integer,
  kickoff timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.player_lineup_status enable row level security;
revoke all on public.player_lineup_status from anon, authenticated;
grant select on public.player_lineup_status to authenticated;
drop policy if exists "player_lineup_status: members read" on public.player_lineup_status;
create policy "player_lineup_status: members read" on public.player_lineup_status for select to authenticated
  using (private.is_league_member());
create index if not exists idx_player_lineup_status_kickoff on public.player_lineup_status (kickoff desc);

-- ---------------------------------------------------------------------------
-- external_player_map: provider id <-> listone id, so a name is matched once
-- ---------------------------------------------------------------------------
create table if not exists public.external_player_map (
  provider text not null,
  external_id integer not null,
  player_id integer not null references public.players (id) on delete cascade,
  external_name text,
  confidence text not null default 'auto' check (confidence in ('auto', 'confirmed')),
  created_at timestamptz not null default now(),
  primary key (provider, external_id)
);
create unique index if not exists external_player_map_provider_player_key
  on public.external_player_map (provider, player_id);
alter table public.external_player_map enable row level security;
revoke all on public.external_player_map from anon, authenticated;
grant select on public.external_player_map to authenticated;
drop policy if exists "external_player_map: admin read" on public.external_player_map;
create policy "external_player_map: admin read" on public.external_player_map for select to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- the feed itself
-- ---------------------------------------------------------------------------
-- Payload:
--   {"statuses":[{player_id,kind,note,source_name,source_url}],
--    "lineups":[{player_id,state,fixture_id,kickoff}],
--    "map":[{external_id,player_id,external_name,confidence}],
--    "provider":"api-football", "clear_missing":true, "run":{...}}
-- Unknown keys are ignored; every list may be missing or empty.
create or replace function private.apply_availability_feed(p_payload jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_statuses jsonb := coalesce(p_payload -> 'statuses', '[]'::jsonb);
  v_lineups jsonb := coalesce(p_payload -> 'lineups', '[]'::jsonb);
  v_map jsonb := coalesce(p_payload -> 'map', '[]'::jsonb);
  v_provider text := coalesce(nullif(trim(p_payload ->> 'provider'), ''), 'api-football');
  v_clear boolean := coalesce((p_payload ->> 'clear_missing')::boolean, false);
  v_kept integer := 0;
  v_applied integer := 0;
  v_cleared integer := 0;
  v_lineup_rows integer := 0;
  v_mapped integer := 0;
  v_fixtures integer[];
  v_summary jsonb;
begin
  if jsonb_typeof(v_statuses) <> 'array' then v_statuses := '[]'::jsonb; end if;
  if jsonb_typeof(v_lineups) <> 'array' then v_lineups := '[]'::jsonb; end if;
  if jsonb_typeof(v_map) <> 'array' then v_map := '[]'::jsonb; end if;

  -- How many of the feed's statuses hit a row the admin wrote by hand: those
  -- are left exactly as they are (the admin's word wins).
  select count(*) into v_kept
  from jsonb_to_recordset(v_statuses) as x(player_id integer)
  join public.player_status ps on ps.player_id = x.player_id and ps.origin = 'manual';

  with input as (
    select distinct on (x.player_id)
      x.player_id,
      x.kind,
      left(nullif(trim(x.note), ''), 200) as note,
      left(nullif(trim(x.source_name), ''), 60) as source_name,
      case when trim(coalesce(x.source_url, '')) ~ '^https?://' then trim(x.source_url) end as source_url
    from jsonb_to_recordset(v_statuses)
      as x(player_id integer, kind text, note text, source_name text, source_url text)
    where x.player_id is not null
      and x.kind in ('injured', 'doubtful', 'suspended', 'unavailable')
      and exists (select 1 from public.players p where p.id = x.player_id)
    order by x.player_id
  )
  insert into public.player_status as ps
    (player_id, kind, note, source_name, source_url, origin, updated_by, updated_at)
  select player_id, kind, note, source_name, source_url, 'feed', null, now()
  from input
  on conflict (player_id) do update
    set kind = excluded.kind,
        note = excluded.note,
        source_name = excluded.source_name,
        source_url = excluded.source_url,
        updated_at = now()
    where ps.origin = 'feed';
  get diagnostics v_applied = row_count;

  -- Players the feed no longer reports are available again — but only the rows
  -- the feed itself wrote.
  if v_clear then
    delete from public.player_status ps
    where ps.origin = 'feed'
      and not exists (
        select 1 from jsonb_to_recordset(v_statuses) as x(player_id integer)
        where x.player_id = ps.player_id
      );
    get diagnostics v_cleared = row_count;
  end if;

  -- Lineups: whatever the provider published for these fixtures replaces what
  -- we had for them, and anything older than a day is dropped.
  select coalesce(array_agg(distinct x.fixture_id), '{}')
    into v_fixtures
  from jsonb_to_recordset(v_lineups) as x(fixture_id integer)
  where x.fixture_id is not null;

  if array_length(v_fixtures, 1) is not null then
    delete from public.player_lineup_status where fixture_id = any (v_fixtures);
  end if;
  delete from public.player_lineup_status where kickoff is null or kickoff < now() - interval '1 day';

  insert into public.player_lineup_status as pl (player_id, state, fixture_id, kickoff, updated_at)
  select distinct on (x.player_id) x.player_id, x.state, x.fixture_id, x.kickoff, now()
  from jsonb_to_recordset(v_lineups)
    as x(player_id integer, state text, fixture_id integer, kickoff timestamptz)
  where x.player_id is not null
    and x.state in ('starting', 'bench')
    and exists (select 1 from public.players p where p.id = x.player_id)
  order by x.player_id, x.state desc -- 'starting' wins over 'bench' on duplicates
  on conflict (player_id) do update
    set state = excluded.state, fixture_id = excluded.fixture_id,
        kickoff = excluded.kickoff, updated_at = now();
  get diagnostics v_lineup_rows = row_count;

  -- Matches found by name: remembered so the next run does not have to guess
  -- again. A mapping the admin confirmed is never downgraded by the feed.
  with deduped as (
    -- one row per provider id…
    select distinct on (x.external_id) x.external_id, x.player_id,
           left(nullif(trim(x.external_name), ''), 80) as external_name
    from jsonb_to_recordset(v_map)
      as x(external_id integer, player_id integer, external_name text)
    where x.external_id is not null
      and x.player_id is not null
      and exists (select 1 from public.players p where p.id = x.player_id)
    order by x.external_id
  ), input as (
    -- …and one per listone player, or the unique index would reject the batch
    select distinct on (player_id) external_id, player_id, external_name
    from deduped
    order by player_id, external_id
  )
  insert into public.external_player_map as m (provider, external_id, player_id, external_name, confidence)
  select v_provider, i.external_id, i.player_id, i.external_name, 'auto'
  from input i
  where not exists (
    select 1 from public.external_player_map e
    where e.provider = v_provider and e.player_id = i.player_id and e.external_id <> i.external_id
  )
  on conflict (provider, external_id) do update
    set player_id = excluded.player_id, external_name = excluded.external_name
    where m.confidence = 'auto';
  get diagnostics v_mapped = row_count;

  v_summary := jsonb_build_object(
    'provider', v_provider,
    'statuses_applied', v_applied,
    'statuses_kept_manual', v_kept,
    'statuses_cleared', v_cleared,
    'lineups', v_lineup_rows,
    'mappings', v_mapped,
    'synced_at', to_jsonb(now())
  );

  insert into public.league_settings (key, value)
  values
    ('availability_synced_at', to_jsonb(now())),
    ('availability_last_run', coalesce(p_payload -> 'run', '{}'::jsonb) || v_summary)
  on conflict (key) do update set value = excluded.value;

  perform private.audit('availability.feed', 'player_status', null, v_summary);
  return v_summary;
end;
$$;
revoke all on function private.apply_availability_feed(jsonb) from public;

create or replace function public.sync_availability(p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
begin
  -- No user path on purpose: the job runs with the service key, so a manager
  -- (or a stolen anon token) can never write availability.
  if not private.is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return private.apply_availability_feed(coalesce(p_payload, '{}'::jsonb));
end;
$$;
revoke all on function public.sync_availability(jsonb) from public, anon, authenticated;
grant execute on function public.sync_availability(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- staleness guard: one page load in fifteen minutes may start a refresh
-- ---------------------------------------------------------------------------
-- A single atomic upsert is the lock: the `where` on the conflict target makes
-- the row-level write race-free, so two concurrent page loads cannot both
-- claim the run (the loser simply gets no row back).
create or replace function public.claim_availability_refresh(p_max_age_seconds integer default 900)
returns boolean
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare
  v_age integer := greatest(60, least(coalesce(p_max_age_seconds, 900), 86400));
  v_claimed boolean := false;
begin
  if auth.uid() is null and not private.is_service_role() then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  insert into public.league_settings as s (key, value)
  values ('availability_refresh_claimed_at', to_jsonb(now()))
  on conflict (key) do update
    set value = to_jsonb(now())
    where (s.value #>> '{}')::timestamptz < now() - make_interval(secs => v_age)
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;
revoke all on function public.claim_availability_refresh(integer) from public, anon;
grant execute on function public.claim_availability_refresh(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin: read the mapping, fix a wrong match
-- ---------------------------------------------------------------------------
create or replace function public.admin_external_map(p_provider text default 'api-football')
returns table (
  provider text,
  external_id integer,
  external_name text,
  player_id integer,
  player_name text,
  team text,
  role_classic text,
  confidence text,
  created_at timestamptz
)
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
begin
  perform private.require_admin();
  return query
    select m.provider, m.external_id, m.external_name, m.player_id,
           p.name, p.team, p.role_classic::text, m.confidence, m.created_at
    from public.external_player_map m
    join public.players p on p.id = m.player_id
    where m.provider = coalesce(nullif(trim(p_provider), ''), 'api-football')
    order by m.confidence desc, p.name;
end;
$$;
revoke all on function public.admin_external_map(text) from public, anon;
grant execute on function public.admin_external_map(text) to authenticated;

create or replace function public.admin_confirm_player_map(
  p_player_id integer, p_provider text, p_external_id integer, p_external_name text default null
) returns void
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare
  v_provider text := coalesce(nullif(trim(p_provider), ''), 'api-football');
begin
  perform private.require_admin();
  if p_external_id is null then
    raise exception 'INVALID_EXTERNAL_ID' using errcode = '22023';
  end if;
  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- One provider id per listone player: the old binding of either side goes.
  delete from public.external_player_map
  where provider = v_provider
    and (player_id = p_player_id or external_id = p_external_id);
  insert into public.external_player_map (provider, external_id, player_id, external_name, confidence)
  values (v_provider, p_external_id, p_player_id, left(nullif(trim(p_external_name), ''), 80), 'confirmed');
  perform private.audit('availability.map', 'players', p_player_id::text,
    jsonb_build_object('provider', v_provider, 'external_id', p_external_id, 'external_name', p_external_name));
end;
$$;
revoke all on function public.admin_confirm_player_map(integer, text, integer, text) from public, anon;
grant execute on function public.admin_confirm_player_map(integer, text, integer, text) to authenticated;
