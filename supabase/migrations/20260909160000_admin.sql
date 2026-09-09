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
