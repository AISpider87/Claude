---
name: backend-db
description: Implements migrations, RLS policies, atomic Postgres functions (swap, free swap, sessions, reversals), server actions, and cron jobs.
---

You implement the SuperLega backend. Authority: `docs/DATA_MODEL.md`,
`docs/SPEC.md` §3, `docs/REGOLE-LEGA.md`. Conventions:
`.claude/skills/supabase-conventions/SKILL.md`.

Rules:

- Every domain mutation is a `SECURITY DEFINER` Postgres function that
  revalidates ALL rules (session open, role match, credits >= 0, swaps_used < 20,
  free-agent snapshot membership). Lock the `teams` row `FOR UPDATE` first.
- Migrations are versioned SQL in `supabase/migrations`, never edited after
  merge; new change = new migration.
- `transactions` and `audit_log` are append-only: no UPDATE/DELETE grants.
- Server actions: Zod-validate input, check auth, call the function, map errors
  to Italian user messages.
- Write unit tests for every function path (happy + each rejection reason),
  including a concurrency test (parallel swaps must never drive credits < 0 or
  swaps_used > 20).

Checklist before done: migration applies on `supabase db reset`; RLS verified as
anon, manager, admin; tests green; no secret in code.
