# ARCHITECTURE — SuperLega

## Stack

- **Next.js** (App Router, TypeScript strict) su **Vercel Hobby** — UI + server actions + route handlers.
- **Supabase Free** — Postgres, Auth (email/password + verifica), RLS, Storage (Excel caricati), Realtime (nice-to-have).
- **Tailwind CSS + shadcn/ui + lucide + Framer Motion** — UI.
- **SheetJS (xlsx)** lato server per il parsing; **Zod** per la validazione input.
- **Vitest** (unit) + **Playwright** (e2e, anche viewport mobile).
- **Serwist** per la PWA; **Brevo** (o Resend) per le email; **GitHub Actions** per CI.

## Principi

1. **Il database è l'autorità.** Tutte le mutazioni di dominio (acquisti, vendite,
   cambi gratuiti, apertura/chiusura sessione, annullamenti) sono **funzioni
   Postgres** (`SECURITY DEFINER`) che rivalidano ogni regola: sessione aperta,
   crediti, limiti di ruolo, limite 20 cambi. Il client e perfino i server action
   non sono mai fidati: chiamano le funzioni, non scrivono le tabelle.
2. **RLS su tutte le tabelle.** Letture secondo il ruolo (tutta la lega legge rose
   e operazioni; solo admin legge audit e impostazioni sensibili). Scritture
   dirette negate: passano solo dalle funzioni.
3. **Concorrenza**: le funzioni prendono lock `FOR UPDATE` sulla riga della squadra
   (crediti e conteggio cambi). Non serve esclusività sul giocatore (proprietà non
   esclusiva), serve integrità di budget e limiti.
4. **Server Components di default**; client components solo dove serve
   interattività (ricerca istantanea, filtri, conferme). TanStack Query solo se
   necessario (listone con filtri client-side).

## Flussi principali

- **Auth**: Supabase Auth → trigger crea `profiles`; iscrizione richiede il codice
  lega (verificato server-side); primo admin promosso da seed/env.
- **Import listone**: upload xlsx → Storage → server action → parser SheetJS →
  anteprima diff → conferma → upsert `players` + snapshot `player_quotations` +
  riga `imports`; foglio Ceduti → `out_of_list`.
- **Sync automatico**: Vercel Cron (Hobby: max 1 esecuzione/giorno → cron alle
  06:00 Europe/Rome ≈ 04:00/05:00 UTC, gestito il DST via check in codice) chiama
  `/api/cron/sync-quotations` (protetta da `CRON_SECRET`): sorgente pluggable
  (`QuotationSource` interface: `fetchLatest(): xlsx | null`) → stesso parser →
  import automatico + log; fa anche da **keep-alive** per Supabase Free.
- **Mercato**: UI → server action (Zod) → funzione Postgres → registro
  `transactions` immutabile; annullamento admin = transazione inversa collegata.
- **Email**: server action/cron → provider (Brevo o Resend, scelto da
  `EMAIL_PROVIDER`): apertura sessione, riepilogo chiusura, avviso agli admin a
  ogni cambio gratuito.

## Struttura repo (target)

```
app/            route (gruppi: (auth), (app), admin, api)
components/     UI (shadcn/ui in components/ui)
lib/            domain, parser, supabase client/server, zod schemas
supabase/       migrations/, seed.sql, config
fixtures/       file Excel reali per i test
tests/          vitest unit + playwright e2e
docs/           SPEC, ARCHITECTURE, DATA_MODEL, ROADMAP, DESIGN, BACKLOG, DECISIONS, REGOLE-LEGA
legacy/         vecchio tool asta (non toccare)
```

## Ambienti e deploy

- Locale: `supabase start` (Docker) + `next dev`; seed di sviluppo con listone
  reale da fixture e 20 squadre finte.
- Produzione: Vercel (env: URL/chiavi Supabase, `CRON_SECRET`, `RESEND_API_KEY`,
  `LEAGUE_CODE` iniziale, email primo admin). Migrazioni via `supabase db push`
  o CLI in CI. Nessun secret nel repo.

## Limiti noti dei piani gratuiti

- Vercel Hobby: 1 esecuzione cron/giorno per job (ok: ne basta una), niente
  code/lunghi job (parsing xlsx ~530 righe è ben sotto i limiti).
- Supabase Free: pausa dopo ~7 giorni di inattività → il cron giornaliero fa da
  keep-alive; email Auth con rate limit basso → email transazionali via Brevo.
- Brevo gratuito: 300 email/giorno, SMTP di Auth e API di lega sullo stesso
  account (20 manager → ampio margine). Resend Free resta un'alternativa.
