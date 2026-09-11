-- M15b: availability feed diagnostics (second provider, Big Balls Sports Data).
--
-- The exact paths of the BSD API could not be verified from the dev network, so
-- the job tries a small list of candidates and must remember which one worked,
-- and the admin must be able to read the raw answer to correct the shape.
-- Two settings keys, both written only by the service role and readable only by
-- the admin (league_settings has an admin-only select policy since M1):
--
--   availability_endpoints    {"injuries": "/v1/football/injuries?league={league}", ...}
--   availability_last_samples {"provider": "bsd", "saved_at": "...",
--                              "samples": [{"endpoint","url","status","body"}]}
--
-- The samples never contain a key: the app redacts them before sending
-- (src/lib/availability/shared.ts) and this function caps their size.
-- Idempotent: it only creates functions and inserts two rows if missing.

-- ---------------------------------------------------------------------------
-- read: the paths a previous run discovered
-- ---------------------------------------------------------------------------
create or replace function public.availability_endpoints()
returns jsonb
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare
  v_value jsonb;
begin
  if not private.is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select value into v_value from public.league_settings where key = 'availability_endpoints';
  if v_value is null or jsonb_typeof(v_value) <> 'object' then
    return '{}'::jsonb;
  end if;
  return v_value;
end;
$$;
revoke all on function public.availability_endpoints() from public, anon, authenticated;
grant execute on function public.availability_endpoints() to service_role;

-- ---------------------------------------------------------------------------
-- write: discovered paths (merged) and the last raw answers (capped)
-- ---------------------------------------------------------------------------
-- p_endpoints null or empty  -> the stored paths are left alone.
-- p_samples   null or empty  -> the stored samples are left alone, so a routine
--                              run 15 minutes later does not wipe what the
--                              admin asked to keep in "modalità diagnostica".
create or replace function public.save_availability_diagnostics(
  p_provider text,
  p_endpoints jsonb default null,
  p_samples jsonb default null
)
returns void
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare
  v_provider text := coalesce(nullif(trim(p_provider), ''), 'unknown');
  v_endpoints jsonb := p_endpoints;
  v_samples jsonb := p_samples;
  v_current jsonb;
begin
  if not private.is_service_role() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if v_endpoints is not null and jsonb_typeof(v_endpoints) = 'object'
     and v_endpoints <> '{}'::jsonb then
    select coalesce(value, '{}'::jsonb) into v_current
    from public.league_settings where key = 'availability_endpoints';
    insert into public.league_settings (key, value)
    values ('availability_endpoints', coalesce(v_current, '{}'::jsonb) || v_endpoints)
    on conflict (key) do update set value = excluded.value;
  end if;

  if v_samples is not null and jsonb_typeof(v_samples) = 'array'
     and jsonb_array_length(v_samples) > 0 then
    -- Belt and braces: the app already caps this at 4 KB.
    if length(v_samples::text) > 8192 then
      v_samples := jsonb_build_array(jsonb_build_object(
        'endpoint', 'troppo grande',
        'url', '',
        'status', 0,
        'body', left(v_samples::text, 4000)
      ));
    end if;
    insert into public.league_settings (key, value)
    values ('availability_last_samples', jsonb_build_object(
      'provider', v_provider,
      'saved_at', to_jsonb(now()),
      'samples', v_samples
    ))
    on conflict (key) do update set value = excluded.value;
  end if;
end;
$$;
revoke all on function public.save_availability_diagnostics(text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_availability_diagnostics(text, jsonb, jsonb) to service_role;

-- Seed the two keys so the admin page finds a row even before the first run.
insert into public.league_settings (key, value) values
  ('availability_endpoints', '{}'::jsonb),
  ('availability_last_samples', '{}'::jsonb)
on conflict (key) do nothing;
