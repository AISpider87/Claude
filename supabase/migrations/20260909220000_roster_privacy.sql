-- Privacy (admin decision 2026-09-10): a manager sees only their own team
-- (roster, credits, swaps, operations). The admin sees everything. The league
-- still sees every team's name, short name, colours and manager through
-- league_teams(); the free-agent list is still computed over every roster (it
-- reveals that a player is owned by someone, never by whom).

drop policy "teams: members read" on public.teams;
create policy "teams: own team or admin" on public.teams for select to authenticated
  using (private.is_admin() or owner_id = auth.uid());

drop policy "roster_players: members read" on public.roster_players;
create policy "roster_players: own team or admin" on public.roster_players for select to authenticated
  using (private.is_admin()
         or exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid()));

drop policy "transactions: members read" on public.transactions;
create policy "transactions: own team or admin" on public.transactions for select to authenticated
  using (private.is_admin()
         or exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid()));

-- The view must keep seeing every roster row: it runs as its owner, not the
-- caller, and gates itself on league membership (inactive users see nothing).
create or replace view public.free_agents
with (security_invoker = false)
as
  select p.*
  from public.players p
  where p.status = 'active'
    and private.is_league_member()
    and not exists (
      select 1 from public.roster_players r
      where r.player_id = p.id and r.released_at is null
    );
revoke all on public.free_agents from anon, authenticated;
grant select on public.free_agents to authenticated;

-- Public face of the teams for every active member (no credits, no roster).
create or replace function public.league_teams()
returns table (
  id uuid, name text, short_name text, color_primary text, color_secondary text,
  owner_id uuid, owner_name text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select t.id, t.name, t.short_name, t.color_primary, t.color_secondary, t.owner_id, p.display_name
  from public.teams t
  left join public.profiles p on p.user_id = t.owner_id
  where private.is_league_member()
  order by t.name;
$$;
revoke all on function public.league_teams() from public, anon;
grant execute on function public.league_teams() to authenticated;

-- market state (holes, free slots) only for the teams one can manage
create or replace function public.team_market_state(p_team_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case when private.can_manage_team(p_team_id) then
    jsonb_build_object(
      'slots', jsonb_build_object(
        'P', private.role_slots(p_team_id, 'P'), 'D', private.role_slots(p_team_id, 'D'),
        'C', private.role_slots(p_team_id, 'C'), 'A', private.role_slots(p_team_id, 'A')),
      'free_slots', jsonb_build_object(
        'P', private.free_slots(p_team_id, 'P'), 'D', private.free_slots(p_team_id, 'D'),
        'C', private.free_slots(p_team_id, 'C'), 'A', private.free_slots(p_team_id, 'A')))
  end;
$$;
