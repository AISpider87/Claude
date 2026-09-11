# The SuperLeague

App web (PWA) per la gestione delle rose e del mercato della lega fantacalcio
**The SuperLeague 2026/27**: 20 squadre, modalità Classic, quotazioni da Fantacalcio.it.

- Documentazione di progetto: `docs/` (`SPEC.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`,
  `ROADMAP.md`, `DESIGN.md`, `REGOLE-LEGA.md`, `DECISIONS.md`, `BACKLOG.md`).
- Convenzioni per chi sviluppa: `CLAUDE.md`.
- Il vecchio tool per l'asta live è in `legacy/` (non fa parte dell'app).

## Stack

Next.js (App Router, TypeScript) · Tailwind CSS · Supabase (Postgres, Auth, RLS) ·
Vitest · Playwright · Vercel + Supabase sui piani gratuiti.

## Sviluppo locale

```bash
npm install
cp .env.example .env.local      # inserisci URL e chiave anon del progetto Supabase
supabase start                  # richiede Docker; applica migrazioni + seed
npm run dev                     # http://localhost:3000
```

Seed locale: codice lega `SUPERLEGA-DEV`, primo admin = chi si registra con
`admin@superlega.local` (vedi `supabase/seed.sql`). Le email locali si leggono su
http://localhost:54324 (Inbucket).

## Comandi

| Comando             | Cosa fa                                                   |
| ------------------- | --------------------------------------------------------- |
| `npm run dev`       | server di sviluppo                                        |
| `npm run build`     | build di produzione                                       |
| `npm run lint`      | ESLint                                                    |
| `npm run typecheck` | TypeScript strict                                         |
| `npm run test`      | test unitari (Vitest)                                     |
| `npm run test:e2e`  | test end-to-end (Playwright, desktop+mobile)              |
| `npm run format`    | Prettier                                                  |
| `npm run test:db`   | test SQL su PostgreSQL locale (migrazioni, RLS, funzioni) |

CI (GitHub Actions) esegue lint, typecheck, format check, unit test, build ed e2e.

## Email di lega

Apertura e chiusura delle sessioni inviano un'email a tutti i membri attivi via
Resend (`RESEND_API_KEY`, `EMAIL_FROM`). Senza chiave le notifiche vengono
saltate e registrate in Admin → Impostazioni. Sync quotazioni: `docs/SYNC.md`.

## Deploy, manuali e sicurezza

- `docs/DEPLOY.md` — messa in produzione passo passo (Supabase, Vercel, Resend), smoke test, backup.
- `docs/MANUALE_ADMIN.md` e `docs/MANUALE_MANAGER.md` — guide d'uso.
- `docs/SECURITY.md` — checklist OWASP e controlli in essere.
- `scripts/backup.sh` — dump completo del database; `scripts/lighthouse.sh` — misure mobile.
