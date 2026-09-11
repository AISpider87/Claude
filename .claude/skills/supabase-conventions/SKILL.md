---
name: supabase-conventions
description: Naming, RLS patterns, Postgres function conventions, migrations, seed, and local testing for the SuperLega Supabase backend. Load when writing any SQL or Supabase code.
---

# Supabase conventions — SuperLega

## Naming

- snake_case ovunque; tabelle plurali (`teams`, `roster_players`); funzioni
  verbo_oggetto (`swap_player`, `open_market_session`); indici
  `idx_<table>_<cols>`; policy `"<table>: <who> <action>"`.
- Migrazioni: `supabase/migrations/YYYYMMDDHHMMSS_short_description.sql`,
  immutabili dopo il merge — correzione = nuova migrazione.

## Pattern RLS

- `alter table X enable row level security;` su OGNI tabella, sempre.
- Helper: `is_admin()` e `is_league_member()` come `security definer stable`,
  in schema `private` non esposto all'API.
- Domain tables: policy SELECT per membri attivi; NESSUNA policy
  INSERT/UPDATE/DELETE (le funzioni SECURITY DEFINER bypassano RLS) +
  `revoke insert, update, delete on ... from anon, authenticated;`.
- `transactions`, `audit_log`: append-only (nessun grant update/delete a
  nessuno, nemmeno alle funzioni: correzioni = righe nuove).
- Testare le policy con `set local role authenticated; set local
request.jwt.claims ...` nei test SQL, per anon/manager/admin.

## Funzioni

- `security definer set search_path = public, private, pg_temp`.
- Prima istruzione: `select ... from teams where id = $1 for update` (lock).
- Validazioni con `raise exception using errcode` e messaggi-chiave stabili
  (`SESSION_NOT_OPEN`, `INSUFFICIENT_CREDITS`, `SWAP_LIMIT_REACHED`,
  `NOT_FREE_AGENT`, `ROLE_MISMATCH`...) mappati a messaggi italiani nel server
  action.
- Ogni funzione scrive audit_log nella stessa transazione.
- `grant execute` solo a `authenticated` (o solo admin dove serve).

## Seed e sviluppo locale

- `supabase start` + `supabase db reset` = migrazioni + `seed.sql`.
- Seed dev: listone importato dalla fixture reale, 20 squadre della lega con
  rose dall'export, utenti finti (1 admin, 2 manager) con password note SOLO
  locali. Il seed di produzione crea solo il primo admin da env.
- Mai chiave service-role nel client; nei server action usare il client
  server-side con i cookie dell'utente (RLS attiva), service-role solo nel cron.

## pg-safeupdate (Supabase)

The API roles run with `pg-safeupdate`: an `UPDATE`/`DELETE` without `WHERE`
fails with "UPDATE requires a WHERE clause" in production only (local tests do
not load the extension). Every `UPDATE`/`DELETE` inside a function must carry a
`WHERE`, using `where true` when it is meant for all rows (migration
`20260909240000`).

Migrations are re-run: the admin pastes the whole cumulative bundle
(`supabase/deploy/updates/*.sql`, rebuilt by `scripts/build-deploy-update.sh`)
again after every release, so an older file runs _after_ the newer ones that
follow it. Never name a function signature that a later migration replaces —
grant over the signatures actually present (`pg_proc` +
`pg_get_function_identity_arguments`) and guard a `create or replace` that a
later overload supersedes. Prove it: run the bundle twice against an
already-migrated database and expect exit 0 both times.
