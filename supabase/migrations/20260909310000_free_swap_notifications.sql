-- Free-swap notifications (admin request 2026-09-11): every free operation of
-- the out-of-list flow (release_out_of_list, and the purchase that fills the
-- free slot without counting toward the 20) emails the ADMINS.
-- Three pieces, all idempotent so the file can be re-run:
--   1. an admins-only recipient list (the session emails keep going to everyone);
--   2. a dedicated rate-limit bucket, so a burst of free swaps does not eat the
--      5 league emails per hour and is not silently dropped;
--   3. an on/off setting, like notifications_enabled.

-- ---------------------------------------------------------------------------
-- 1. recipients: admins only when asked
-- ---------------------------------------------------------------------------
-- The parameter changes the signature, so the old zero-argument function is
-- dropped: two overloads would make the PostgREST call ambiguous.
drop function if exists public.admin_notification_recipients();
drop function if exists public.admin_notification_recipients(boolean);
create function public.admin_notification_recipients(p_admins_only boolean default false)
returns table (email text, display_name text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.email, p.display_name
  from public.profiles p
  where (private.is_admin() or private.is_service_role())
    and p.is_active and p.email is not null
    and (not coalesce(p_admins_only, false) or p.role = 'admin');
$$;
revoke all on function public.admin_notification_recipients(boolean) from public, anon;
grant execute on function public.admin_notification_recipients(boolean) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.admin_notification_recipients(boolean) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. rate limits: a bucket of its own for operational notifications
-- ---------------------------------------------------------------------------
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
    when 'market'     then v_max := 10; v_window := 60;
    when 'import'     then v_max := 10; v_window := 600;
    when 'export'     then v_max := 10; v_window := 600;
    when 'email'      then v_max := 5;  v_window := 3600;
    -- one email per free swap: 30/hour is far above any honest burst and still
    -- caps what a single manager can make the app send.
    when 'email_ops'  then v_max := 30; v_window := 3600;
    when 'admin'      then v_max := 60; v_window := 60;
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
revoke all on function public.consume_rate_limit(text) from public, anon;
grant execute on function public.consume_rate_limit(text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.consume_rate_limit(text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. settings: the admin can turn the new notification off on its own
-- ---------------------------------------------------------------------------
-- The setting whitelist is part of admin_set_setting: without this branch the
-- new checkbox would come back as UNKNOWN_SETTING.
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
  elsif p_key in ('sync_enabled', 'notifications_enabled', 'notifications_free_swap') then
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

insert into public.league_settings (key, value) values
  ('notifications_enabled', 'true'),
  ('notifications_free_swap', 'true')
on conflict (key) do nothing;
