# DEPLOY — SuperLega in produzione (0 €/mese)

Percorso: **GitHub → Vercel (app) + Supabase (database, auth, storage) + Resend
(email)**, tutti sui piani gratuiti. Tempo stimato la prima volta: 45–60 minuti.
Tutte le chiavi vanno **solo** nelle impostazioni di Vercel/Supabase, mai nel repo.

## 0. Prerequisiti

- Account GitHub con il repository (già presente).
- Node 22 e la **Supabase CLI** sul computer dell'admin
  (`npm i -g supabase` oppure `brew install supabase/tap/supabase`).
- Un indirizzo email per il primo admin (sarà il tuo login).

## 1. Supabase — progetto e database

1. Crea un account su supabase.com → **New project**: nome `superlega`,
   regione **EU (Frankfurt)**, piano Free. Salva la **password del database**.
2. Applica lo schema del database. **Opzione A — senza terminale (consigliata)**:
   apri su GitHub il file `supabase/deploy/schema.sql` (branch del progetto),
   premi **Raw**, seleziona tutto (⌘A) e copia (⌘C). Nella dashboard Supabase
   vai su **SQL Editor → New query**, incolla e premi **Run** (in basso a
   destra; ci vogliono pochi secondi). Deve finire con "Success. No rows
   returned". Eseguilo **una sola volta**. Il file è generato dalle migrazioni
   con `scripts/build-deploy-sql.sh`.
   **Opzione B — con la Supabase CLI** (per chi ha Node installato):
   ```bash
   supabase login
   supabase link --project-ref <ref-del-progetto>
   supabase db push            # applica supabase/migrations/* in ordine
   ```
3. Bootstrap della lega (una volta sola, dallo **SQL Editor** della dashboard):
   ```sql
   insert into public.league_settings (key, value) values
     ('league_code', '"SCEGLI-UN-CODICE"'),
     ('bootstrap_admin_email', '"tua-email@esempio.it"')
   on conflict (key) do update set value = excluded.value;
   ```
   Chi si registra con quell'email diventa **admin**; gli altri admin si
   promuovono poi da _Admin → Utenti_. Il codice lega si cambia da
   _Admin → Impostazioni_.
4. **Auth → URL Configuration**: `Site URL` = URL dell'app su Vercel (punto 3);
   `Redirect URLs` = `https://<app>.vercel.app/auth/callback`.
5. **Auth → Email Templates**: incolla il contenuto di
   `supabase/templates/confirmation.html`, `recovery.html`, `email_change.html`
   nei rispettivi template (usano il link `token_hash`, che funziona anche da
   iPhone e dall'app installata). Oggetti: vedi `supabase/config.toml`.
6. **Auth → Providers → Email**: conferma email attiva (default). Le email di
   Auth sul piano Free hanno un limite basso (circa 2–4 all'ora): per una lega
   di 20 persone va bene se le registrazioni non avvengono tutte nello stesso
   minuto; in alternativa configura un SMTP personalizzato con Resend
   (Auth → SMTP Settings).
7. **Storage**: il bucket `imports` è creato dalla migrazione; verifica che
   esista in _Storage_.
8. **Settings → API**: copia `Project URL`, `anon public key` e
   `service_role key` (segreta).

## 2. Resend — email di lega (facoltativo ma consigliato)

1. Account su resend.com (Free: 100 email/giorno). Crea una **API key**.
2. Senza dominio proprio puoi usare il mittente di prova
   `SuperLega <onboarding@resend.dev>` (le email arrivano solo all'indirizzo
   del tuo account Resend: utile per il test, non per la lega). Per inviare a
   tutti serve un **dominio verificato** (DNS) e `EMAIL_FROM=SuperLega <lega@tuodominio.it>`.
3. Senza chiave l'app funziona lo stesso: le notifiche vengono "saltate" e
   registrate in _Admin → Impostazioni_.

## 3. Vercel — app e cron

1. Account su vercel.com con GitHub → **Add New Project** → importa il repo
   (branch principale). Framework: Next.js (rilevato). Piano Hobby.
2. **Environment Variables** (Production; le `NEXT_PUBLIC_*` anche in Preview):

   | Variabile                       | Valore                                                       |
   | ------------------------------- | ------------------------------------------------------------ |
   | `NEXT_PUBLIC_SUPABASE_URL`      | Project URL di Supabase                                      |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key                                              |
   | `NEXT_PUBLIC_SITE_URL`          | `https://<app>.vercel.app` (o il dominio)                    |
   | `SUPABASE_SERVICE_ROLE_KEY`     | service_role key (solo server)                               |
   | `CRON_SECRET`                   | stringa casuale lunga (`openssl rand -hex 32`)               |
   | `RESEND_API_KEY`                | chiave Resend (vuota = email saltate)                        |
   | `EMAIL_FROM`                    | mittente, es. `SuperLega <lega@tuodominio.it>`               |
   | `QUOTATIONS_SOURCE_URL`         | **vuota** finché non verifichi Fantacalcio.it (docs/SYNC.md) |

3. **Branch di produzione**: se il repository ha come branch predefinito uno
   diverso da `main`, in Vercel vai su _Settings → Environments → Production →
   Branch Tracking_ e scrivi `main`; il primo deploy parte al primo push su
   `main` (o da _Deployments → Create Deployment_).
4. **Deploy**. Il cron in `vercel.json` (`30 4 * * *`, una volta al giorno come
   consente Hobby) chiama `/api/cron/sync-quotations` con `CRON_SECRET`:
   fa da keep-alive per Supabase Free (che altrimenti si pausa dopo 7 giorni
   di inattività) e, se configurata una sorgente, importa le quotazioni.
5. Dominio personalizzato (facoltativo): _Settings → Domains_; aggiorna poi
   `NEXT_PUBLIC_SITE_URL` e gli URL in Supabase Auth.

## 4. Smoke test in produzione (10 minuti)

1. Apri l'URL da iPhone: `/registrati` con il codice lega e la **tua email
   admin** → ricevi l'email → conferma → entri come admin.
2. _Admin → Listone_: carica `Quotazioni_Fantacalcio_Stagione_2026_27.xlsx`,
   guarda l'anteprima, conferma. Verifica i conteggi (attivi / fuori lista).
3. _Admin → Squadre → Import rose_: carica l'export "Rose", risolvi eventuali
   omonimi, conferma. Controlla una squadra: 23 giocatori, crediti = 250 − speso.
4. _Admin → Sessioni_: crea una **sessione di prova** con chiusura tra 1 ora,
   aprila; da un secondo account manager (collegato a una squadra) fai un
   cambio; annullalo da _Admin → Registro operazioni_; chiudi la sessione e
   leggi il report.
5. _Admin → Impostazioni_: scarica i tre export Excel; verifica lo stato delle
   email (inviata/saltata).
6. Installa l'app sulla home (iPhone: Condividi → Aggiungi alla schermata Home).
7. Il giorno dopo controlla in _Admin → Listone_ che il cron sia passato
   (riga `source = auto` o comunque nessun errore nel log Vercel → Cron).

## 5. Checklist di primo avvio con la lega

- [ ] Codice lega comunicato ai 20 manager (chat privata, non pubblica).
- [ ] Listone importato e aggiornato alla data.
- [ ] Rose importate; tutti i manager registrati e **collegati** alla loro
      squadra (_Admin → Squadre → Collega manager_; l'elenco dei non collegati è
      in _Admin → Utenti_).
- [ ] Sessione di prova fatta e annullata (le operazioni di prova si annullano,
      non si cancellano: restano nel registro come annullate).
- [ ] Prima sessione vera programmata (dopo la 3ª giornata, chiusura giovedì 20:00).
- [ ] Backup fatto (sezione 6).

## 6. Backup e ripristino

- **Excel**: _Admin → Impostazioni → Export_ (rose, listone, operazioni) — da
  fare almeno dopo ogni sessione.
- **Database completo**: `DATABASE_URL="<connection string>" scripts/backup.sh`
  crea `backups/superlega-<data>.sql.gz` (serve `pg_dump`; la connection string
  è in _Settings → Database_, usa il "session pooler" se la rete è solo IPv4).
  Ripristino in un progetto vuoto: `gunzip -c file.sql.gz | psql "$DATABASE_URL"`.
- Supabase Free non fa backup automatici: pianifica il backup manuale
  settimanale durante la stagione.

## 7. Limiti dei piani gratuiti da conoscere

- **Supabase Free**: pausa dopo ~7 giorni senza traffico (il cron la evita);
  500 MB database (la lega ne usa pochi MB); email Auth limitate.
- **Vercel Hobby**: uso personale/non commerciale; 1 esecuzione cron al giorno
  per job; funzioni serverless con timeout 60 s (l'import del listone impiega
  pochi secondi).
- **Resend Free**: 100 email/giorno, 3.000/mese; dominio verificato necessario
  per inviare a indirizzi diversi dal tuo.

## 8. Aggiornamenti

Ogni push sul branch principale rideploya l'app. Nuove migrazioni:
`supabase db push` dal computer dell'admin **prima** del deploy che le usa.
Le migrazioni non si modificano dopo l'applicazione: si aggiunge un nuovo file.
