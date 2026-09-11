-- Supabase runs the API roles with pg-safeupdate: an UPDATE without a WHERE
-- clause is rejected ("UPDATE requires a WHERE clause"). The extra-budget credit
-- to every team at session opening was written without one, so "Apri ora" and
-- the automatic opening failed in production while passing the local tests.
-- Rule from now on: every UPDATE/DELETE in a function carries a WHERE, even
-- "where true" when it is meant for every row.

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
    update public.teams set credits = credits + v_session.extra_budget where true;
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
