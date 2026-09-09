# CLAUDE.md — SuperLega

App web PWA per la gestione delle rose della lega fantacalcio **SuperLega 2026/27**
(20 squadre, Classic). Docs autoritative in `docs/`: **SPEC.md** (requisiti
congelati — modificarla solo con ok dell'admin), REGOLE-LEGA.md, ARCHITECTURE.md,
DATA_MODEL.md, ROADMAP.md, DESIGN.md, DECISIONS.md (annota qui ogni scelta),
BACKLOG.md.

## Convenzioni

- UI in **italiano**; codice, commenti, commit, identificatori in **inglese**.
- Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`).
- TypeScript strict; Zod su ogni input; niente `any` non giustificato.
- Date: UTC nel DB, Europe/Rome in UI. Crediti/prezzi: interi.
- Nessun secret nel repo, mai. Env in `.env.local` (gitignored) / Vercel.
- `legacy/` è il vecchio tool asta: non toccare.
- `fixtures/` contiene i file Excel reali: usarli nei test del parser.

## Comandi (da M1 in poi)

- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck`
- `npm run test` (Vitest) · `npm run test:e2e` (Playwright)
- `supabase start` / `supabase db reset` (migrazioni + seed locali)

## Regole di dominio in sintesi (dettagli in docs/REGOLE-LEGA.md e SPEC §3)

- 20 squadre; rosa 23 = 3P/7D/7C/6A; budget 250 (+5 a ogni apertura sessione);
  crediti mai negativi.
- **Proprietà NON esclusiva**: lo stesso giocatore può stare in più rose.
  Svincolato = posseduto da nessuno; la lista svincolati è fotografata
  all'apertura della sessione.
- Operazione = **cambio** (esce uno, entra uno svincolato dello stesso ruolo),
  solo a sessione aperta; max **20 cambi/stagione** a squadra.
- Prezzi sempre **Qt.A dell'ultimo listone importato** (acquisto e rientro).
- **Fuori lista** (foglio Ceduti): cambio **gratuito** (non conta nei 20), anche
  fuori sessione; rimborso = prezzo pagato.
- Registro operazioni immutabile; annullamento solo admin → transazione inversa.
- Ogni regola è applicata **nelle funzioni Postgres**, mai solo nel client;
  RLS su tutte le tabelle; scritture dirette alle tabelle negate.
- Upsert listone per **Id Fantacalcio**, mai per nome; import rose per nome con
  report anomalie.

## Definition of done (per milestone)

1. Lint, typecheck e test verdi in locale e in CI.
2. Funziona da viewport mobile (375px) senza zoom/scroll orizzontale.
3. Regole di dominio testate a livello DB/unit, non solo via UI.
4. Revisione `qa-tester` e `security-reviewer` passata (blocca se critica).
5. Riepilogo ≤ 8 righe: fatto / test / rischi / prossimo passo.
6. Decisioni prese annotate in `docs/DECISIONS.md`.

## Quando fermarsi e chiedere all'admin

Credenziali/chiavi/account esterni; scelte che cambiano `docs/SPEC.md`; blocchi
tecnici persistenti; qualunque costo > 0 €. Per il resto: decidere, annotare,
procedere.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
