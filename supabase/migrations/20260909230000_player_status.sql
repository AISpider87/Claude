-- Player availability (injured, doubtful, suspended, unavailable) with its source.
-- Written by the admin by hand today; a sync job may fill it later through the
-- same private function. Only non-"ok" rows are stored: clearing = delete.

create table if not exists public.player_status (
  player_id integer primary key references public.players (id) on delete cascade,
  kind text not null check (kind in ('injured', 'doubtful', 'suspended', 'unavailable')),
  note text,
  source_name text,
  source_url text check (source_url is null or source_url ~ '^https?://'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.player_status enable row level security;
revoke all on public.player_status from anon, authenticated;
grant select on public.player_status to authenticated;
drop policy if exists "player_status: members read" on public.player_status;
create policy "player_status: members read" on public.player_status for select to authenticated
  using (private.is_league_member());

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
  insert into public.player_status (player_id, kind, note, source_name, source_url, updated_by, updated_at)
  values (p_player_id, p_kind, left(nullif(trim(p_note), ''), 200), left(nullif(trim(p_source_name), ''), 60),
          nullif(trim(p_source_url), ''), auth.uid(), now())
  on conflict (player_id) do update
    set kind = excluded.kind, note = excluded.note, source_name = excluded.source_name,
        source_url = excluded.source_url, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function private.set_player_status(integer, text, text, text, text) from public;

create or replace function public.admin_set_player_status(
  p_player_id integer, p_kind text, p_note text default null,
  p_source_name text default null, p_source_url text default null
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_admin();
  perform private.set_player_status(p_player_id, p_kind, p_note, p_source_name, p_source_url);
  perform private.audit('player.status', 'players', p_player_id::text,
    jsonb_build_object('kind', p_kind, 'source', p_source_name));
end;
$$;
revoke all on function public.admin_set_player_status(integer, text, text, text, text) from public, anon;
grant execute on function public.admin_set_player_status(integer, text, text, text, text) to authenticated;
