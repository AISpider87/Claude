-- Market sessions open and close by themselves at the scheduled times.
-- sync_market_sessions() is idempotent and cheap: the app calls it on every
-- authenticated page load and from the daily cron, so a scheduled session opens
-- (snapshot + extra budget) at the first request after opens_at and an open
-- session closes (validation report) at the first request after closes_at.
-- "Apri ora" / "Chiudi sessione" remain available to the admin to act early.

-- The service role (cron, server jobs) is trusted like an admin for
-- notifications and is exempt from the per-user rate limiter.
-- The role claim of the verified JWT, as PostgREST exposes it (inside a
-- security definer function current_user is the owner, so it cannot be used).
create or replace function private.is_service_role()
returns boolean
language sql stable
as $$
  select coalesce(
    coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    ) = 'service_role',
    false);
$$;
revoke all on function private.is_service_role() from public;

-- ---------------------------------------------------------------------------
-- roster report without the admin gate (used by the automatic close)
-- ---------------------------------------------------------------------------
create or replace function private.rosters_report()
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_comp jsonb := coalesce(private.setting_json('roster_composition'), '{"P":3,"D":7,"C":7,"A":6}'::jsonb);
  v_target integer := (v_comp ->> 'P')::int + (v_comp ->> 'D')::int + (v_comp ->> 'C')::int + (v_comp ->> 'A')::int;
  v_report jsonb;
begin
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
revoke all on function private.rosters_report() from public;

create or replace function public.validate_rosters()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  return private.rosters_report();
end;
$$;
revoke all on function public.validate_rosters() from public, anon;
grant execute on function public.validate_rosters() to authenticated;

-- ---------------------------------------------------------------------------
-- open / close without the admin gate; the public functions keep it
-- ---------------------------------------------------------------------------
create or replace function private.open_session(p_id uuid, p_source text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_session public.market_sessions%rowtype;
  v_free integer;
begin
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
    jsonb_build_object('free_agents', v_free, 'extra_budget', v_session.extra_budget, 'source', p_source));
end;
$$;
revoke all on function private.open_session(uuid, text) from public;

create or replace function private.close_session(p_id uuid, p_source text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_report jsonb;
begin
  select status into v_status from public.market_sessions where id = p_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'SESSION_NOT_OPEN' using errcode = '55000';
  end if;
  v_report := private.rosters_report();
  update public.market_sessions
  set status = 'closed', closed_at = now(),
      closes_at = greatest(least(closes_at, now()), opens_at + interval '1 second'),
      validation_report = v_report
  where id = p_id;
  perform private.audit('session.close', 'market_sessions', p_id::text,
    jsonb_build_object('invalid', v_report -> 'invalid', 'source', p_source));
  return v_report;
end;
$$;
revoke all on function private.close_session(uuid, text) from public;

create or replace function public.open_market_session(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  perform private.open_session(p_id, 'admin');
end;
$$;
revoke all on function public.open_market_session(uuid) from public, anon;
grant execute on function public.open_market_session(uuid) to authenticated;

create or replace function public.close_market_session(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  return private.close_session(p_id, 'admin');
end;
$$;
revoke all on function public.close_market_session(uuid) from public, anon;
grant execute on function public.close_market_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- automatic transitions
-- ---------------------------------------------------------------------------
create or replace function public.sync_market_sessions()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_opened uuid[] := '{}';
  v_closed uuid[] := '{}';
begin
  if auth.uid() is null and not private.is_service_role() then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  -- expired sessions close first, so the next scheduled one can open
  for v_id in
    select id from public.market_sessions
    where status = 'open' and closes_at <= now()
    order by closes_at
    for update skip locked
  loop
    perform private.close_session(v_id, 'auto');
    v_closed := v_closed || v_id;
  end loop;

  -- the earliest due session opens; a later one waits for it to close
  for v_id in
    select id from public.market_sessions
    where status = 'scheduled' and opens_at <= now() and closes_at > now()
    order by opens_at
    for update skip locked
  loop
    exit when exists (select 1 from public.market_sessions where status = 'open');
    perform private.open_session(v_id, 'auto');
    v_opened := v_opened || v_id;
  end loop;

  return jsonb_build_object('opened', to_jsonb(v_opened), 'closed', to_jsonb(v_closed));
end;
$$;
revoke all on function public.sync_market_sessions() from public, anon;
grant execute on function public.sync_market_sessions() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.sync_market_sessions() to service_role;
    grant execute on function public.admin_notification_recipients() to service_role;
    grant execute on function public.log_notification(text, text, integer, text, text) to service_role;
    grant execute on function public.consume_rate_limit(text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- notifications: the service role may read recipients and log outcomes
-- (automatic transitions are notified by the server, not by an admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_notification_recipients()
returns table (email text, display_name text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.email, p.display_name
  from public.profiles p
  where (private.is_admin() or private.is_service_role()) and p.is_active and p.email is not null;
$$;

create or replace function public.log_notification(
  p_kind text, p_subject text, p_recipients integer, p_status text, p_detail text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not (private.is_admin() or private.is_service_role()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_recipients < 0 or p_status not in ('sent', 'partial', 'failed', 'skipped') then
    raise exception 'INVALID_NOTIFICATION' using errcode = '22023';
  end if;
  insert into public.notifications (kind, subject, recipients, status, detail, created_by)
  values (p_kind, p_subject, p_recipients, p_status, left(p_detail, 500), auth.uid());
end;
$$;

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
  if private.is_service_role() then
    return;
  end if;
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
