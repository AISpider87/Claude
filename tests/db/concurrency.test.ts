/**
 * Concurrency test against a real PostgreSQL (the local harness or a CI service):
 * parallel swaps on one team must never drive credits below zero or swaps_used
 * past the limit, and parallel purchases of the same free agent by different
 * teams must ALL succeed (ownership is not exclusive).
 *
 * Skipped unless DATABASE_URL points at a database prepared by scripts/db-test.sh.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

async function connect() {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

/** Runs `fn` inside a transaction impersonating a user, like PostgREST would. */
async function asUser<T>(c: Client, userId: string, fn: () => Promise<T>): Promise<T> {
  await c.query("begin");
  await c.query("select auth.test_login($1, 'authenticated')", [userId]);
  try {
    const out = await fn();
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

run("market concurrency", () => {
  const admin = { id: "", email: "cc-admin@superlega.local" };
  const mario = { id: "", email: "cc-mario@example.com" };
  const luca = { id: "", email: "cc-luca@example.com" };
  let teamA = "";
  let teamB = "";
  let setup: Client;

  beforeAll(async () => {
    setup = await connect();
    await setup.query(`
      alter table public.transactions disable trigger trg_transactions_immutable;
      delete from public.transactions; delete from public.session_free_agents; delete from public.market_sessions;
      delete from public.player_quotations; delete from public.roster_players; delete from public.teams; delete from public.players;
      delete from public.profiles; delete from auth.users;
      alter table public.transactions enable trigger trg_transactions_immutable;
      insert into public.players (id, name, team, role_classic, qt_a, qt_i, diff) values
        (1, 'Por1', 'Roma', 'P', 10, 10, 0), (2, 'Por2', 'Inter', 'P', 10, 10, 0),
        (3, 'Por3', 'Como', 'P', 10, 10, 0), (4, 'Por4', 'Lecce', 'P', 10, 10, 0),
        (5, 'Att1', 'Roma', 'A', 10, 10, 0), (6, 'Att2', 'Inter', 'A', 25, 25, 0),
        (7, 'Att3', 'Como', 'A', 25, 25, 0), (8, 'Att4', 'Lecce', 'A', 25, 25, 0);
    `);
    for (const u of [admin, mario, luca]) {
      const r = await setup.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ($1, '{"league_code": "SUPERLEGA-DEV"}') returning id`,
        [u.email],
      );
      u.id = r.rows[0].id;
    }
    await setup.query("update public.profiles set role = 'admin' where user_id = $1", [admin.id]);
    await asUser(setup, admin.id, async () => {
      teamA = (await setup.query("select public.admin_upsert_team(null, 'Alpha') as id")).rows[0]
        .id;
      teamB = (await setup.query("select public.admin_upsert_team(null, 'Beta') as id")).rows[0].id;
      await setup.query("select public.admin_set_team_owner($1, $2)", [teamA, mario.id]);
      await setup.query("select public.admin_set_team_owner($1, $2)", [teamB, luca.id]);
      // Alpha owns Por1 and three attackers worth 10 each; Beta owns Por2.
      await setup.query("select public.admin_assign_player($1, 1, 10)", [teamA]);
      await setup.query("select public.admin_assign_player($1, 5, 10)", [teamA]);
      await setup.query("select public.admin_assign_player($1, 2, 10)", [teamB]);
      await setup.query("select public.admin_set_team_credits($1, 20, 'cc')", [teamA]);
      await setup.query("select public.admin_set_team_credits($1, 20, 'cc')", [teamB]);
      await setup.query("select public.admin_set_setting('season_swap_limit', '1')");
      const s = await setup.query(
        "select public.admin_create_session('CC', now(), now() + interval '1 day', 0) as id",
      );
      await setup.query("select public.open_market_session($1)", [s.rows[0].id]);
    });
  });

  afterAll(async () => {
    await asUser(setup, admin.id, () =>
      setup.query("select public.admin_set_setting('season_swap_limit', '20')"),
    ).catch(() => {});
    await setup?.end();
  });

  it("parallel swaps on one team: exactly one passes (limit 1, credits ≥ 0)", async () => {
    // Alpha (25 credits after +0 extra): Att1 (10) -> Att2/Att3/Att4 (25 each): 25 + 10 - 25 = 10, fine
    // for one swap; the second must hit the swap limit (1) or the credits floor, never both pass.
    const clients = await Promise.all([connect(), connect(), connect()]);
    const targets = [6, 7, 8];
    const results = await Promise.allSettled(
      clients.map((c, i) =>
        asUser(c, mario.id, async () => {
          const r = await c.query("select public.swap_player($1, 5, $2) as id", [
            teamA,
            targets[i],
          ]);
          return r.rows[0].id as string;
        }),
      ),
    );
    await Promise.all(clients.map((c) => c.end()));

    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBe(1);
    const team = await setup.query("select credits, swaps_used from public.teams where id = $1", [
      teamA,
    ]);
    expect(team.rows[0].swaps_used).toBe(1);
    expect(team.rows[0].credits).toBeGreaterThanOrEqual(0);
    const active = await setup.query(
      "select count(*)::int as n from public.roster_players where team_id = $1 and released_at is null",
      [teamA],
    );
    expect(active.rows[0].n).toBe(2);
  });

  it("parallel purchases of the same free agent by two teams both succeed", async () => {
    const [c1, c2] = await Promise.all([connect(), connect()]);
    // Alpha: Por1 -> Por3, Beta: Por2 -> Por3 (Por3 is free in the snapshot; 10 in, 10 out).
    await asUser(setup, admin.id, () =>
      setup.query("select public.admin_set_setting('season_swap_limit', '5')"),
    );
    const results = await Promise.allSettled([
      asUser(c1, mario.id, () => c1.query("select public.swap_player($1, 1, 3)", [teamA])),
      asUser(c2, luca.id, () => c2.query("select public.swap_player($1, 2, 3)", [teamB])),
    ]);
    await Promise.all([c1.end(), c2.end()]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const owners = await setup.query(
      "select count(*)::int as n from public.roster_players where player_id = 3 and released_at is null",
    );
    expect(owners.rows[0].n).toBe(2);
  });
});
