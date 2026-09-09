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
grant execute on function public.team_roster_summary(uuid) to authenticated;
