-- Security review of market v2 / session autopilot (2026-09-10):
-- H1 the DB-side market throttle must count the v2 operation kinds;
-- M1 automatic transitions are attributed to nobody (user_id null, source 'auto'),
--    not to the manager whose page load triggered them;
-- L1 re-check the single-open rule after taking the teams lock.

create or replace function private.check_market_throttle(p_team_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_max integer := private.setting_int('market_ops_per_minute', 5);
begin
  if (select count(*) from public.transactions
      where team_id = p_team_id
        and kind in ('swap', 'free_swap', 'sell', 'buy', 'free_release')
        and created_at > now() - interval '1 minute') >= v_max then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
end;
$$;
revoke all on function private.check_market_throttle(uuid) from public;

-- audit with an explicit actor (null = the system)
create or replace function private.audit_as(
  p_user uuid, p_action text, p_entity text default null, p_entity_id text default null, p_payload jsonb default null
) returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_log (user_id, action, entity, entity_id, payload)
  values (p_user, p_action, p_entity, p_entity_id, p_payload);
$$;
revoke all on function private.audit_as(uuid, text, text, text, jsonb) from public;

create or replace function private.open_session(p_id uuid, p_source text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_session public.market_sessions%rowtype;
  v_free integer;
  v_actor uuid := case when p_source = 'auto' then null else auth.uid() end;
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

  -- lock every team so the +5 and the snapshot happen against a quiet ledger,
  -- then re-check: a concurrent open may have won the race meanwhile
  perform 1 from public.teams for update;
  if exists (select 1 from public.market_sessions where status = 'open') then
    raise exception 'ANOTHER_SESSION_OPEN' using errcode = '55000';
  end if;

  insert into public.session_free_agents (session_id, player_id)
  select p_id, id from public.free_agents
  on conflict do nothing;
  select count(*) into v_free from public.session_free_agents where session_id = p_id;

  if not v_session.extra_budget_applied and v_session.extra_budget > 0 then
    update public.teams set credits = credits + v_session.extra_budget;
    insert into public.transactions (team_id, session_id, kind, credits_delta, note, created_by)
    select id, p_id, 'admin_credits', v_session.extra_budget, 'Budget extra apertura sessione', v_actor
    from public.teams;
  end if;

  update public.market_sessions
  set status = 'open', opened_at = now(), extra_budget_applied = true,
      opens_at = least(opens_at, now())
  where id = p_id;

  perform private.audit_as(v_actor, 'session.open', 'market_sessions', p_id::text,
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
  v_actor uuid := case when p_source = 'auto' then null else auth.uid() end;
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
  perform private.audit_as(v_actor, 'session.close', 'market_sessions', p_id::text,
    jsonb_build_object('invalid', v_report -> 'invalid', 'source', p_source));
  return v_report;
end;
$$;
revoke all on function private.close_session(uuid, text) from public;
