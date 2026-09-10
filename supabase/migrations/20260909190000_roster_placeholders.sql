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
