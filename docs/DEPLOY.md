# DEPLOY — SuperLega in produzione (0 €/mese)

Percorso: **GitHub → Vercel (app) + Supabase (database, auth, storage) + Brevo
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
6. **Auth → Providers → Email**: conferma email attiva (default). L'SMTP
   integrato di Supabase manda email **solo ai membri del progetto**: per la
   lega serve un **SMTP personalizzato** (_Auth → Emails → SMTP Settings_).
   Con **Brevo** (piano gratuito, 300 email/giorno):
   - _Senders_: verifica l'indirizzo che farà da mittente (basta l'email
     personale; gli avvisi DKIM/DMARC non bloccano l'invio).
   - _SMTP e API → scheda SMTP_: copia il **Login** (es. `xxxx@smtp-brevo.com`)
     e genera una **chiave SMTP** (non l'API key).
   - _Sicurezza → IP autorizzati_: **Disattiva per le chiavi SMTP**, altrimenti
     Supabase riceve `525 Unauthorized IP address`.
   - In Supabase: Sender email = indirizzo verificato, Host
     `smtp-relay.brevo.com`, porta `587`, Username = Login, Password = chiave
     SMTP. Errore `535 Authentication failed` = login/chiave sbagliati.
   - Il motivo esatto di un invio fallito è in _Logs & Analytics → Auth_.
     L'app limita le registrazioni a 5 tentativi/ora per indirizzo: durante le
     prove si azzera con `delete from private.rate_limits;` nello SQL Editor.
7. **Storage**: il bucket `imports` è creato dalla migrazione; verifica che
   esista in _Storage_.
8. **Settings → API**: copia `Project URL`, `anon public key` e
   `service_role key` (segreta).

## 2. Email di lega — Brevo (consigliato) o Resend

Le email dell'app (apertura e chiusura sessione, avviso agli admin a ogni
cambio gratuito) escono dallo **stesso account Brevo** già usato per l'SMTP di
Supabase Auth al punto 1.6: niente nuovo servizio, niente costi (piano
gratuito, 300 email/giorno complessive).

1. Brevo → _SMTP e API_ → scheda **API Keys** (non la scheda SMTP: la chiave
   SMTP non vale per l'API) → **Generate a new API key**. Il valore inizia con
   `xkeysib-` e si vede **una volta sola**: copialo subito.
2. Su Vercel: `BREVO_API_KEY` = quella chiave, `EMAIL_PROVIDER=brevo`
   (facoltativa: con `BREVO_API_KEY` presente Brevo è già il predefinito).
3. `EMAIL_FROM` = `SuperLega <indirizzo>` dove **l'indirizzo deve essere un
   mittente verificato su Brevo** (_Mittenti, domini e IP dedicati →
   Mittenti_, lo stesso verificato per l'SMTP di Auth). Se non lo è, Brevo
   rifiuta l'invio e il motivo compare **testuale** in _Admin → Impostazioni
   lega → Email inviate_ (es. `Brevo 400: Sender email is not valid...`).
4. In alternativa **Resend** (resend.com, Free 100 email/giorno): `RESEND_API_KEY`
   e `EMAIL_PROVIDER=resend`. Senza dominio verificato il mittente di prova
   `SuperLega <onboarding@resend.dev>` consegna solo all'indirizzo del tuo
   account Resend: utile per il test, non per la lega.
5. Senza nessuna chiave l'app funziona lo stesso: le notifiche vengono
   "saltate" e registrate in _Admin → Impostazioni_.
6. L'avviso "cambio gratuito" va **solo agli admin** e parte dal server con la
   `SUPABASE_SERVICE_ROLE_KEY`: se quella variabile manca, l'operazione di
   mercato resta valida ma l'email non parte.

## 3. Vercel — app e cron

1. Account su vercel.com con GitHub → **Add New Project** → importa il repo
   (branch principale). Framework: Next.js (rilevato). Piano Hobby.
2. **Environment Variables** (Production; le `NEXT_PUBLIC_*` anche in Preview):

   | Variabile                       | Valore                                                                                                                                         |
   | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | Project URL di Supabase                                                                                                                        |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key                                                                                                                                |
   | `NEXT_PUBLIC_SITE_URL`          | `https://<app>.vercel.app` (o il dominio)                                                                                                      |
   | `SUPABASE_SERVICE_ROLE_KEY`     | service_role key (solo server)                                                                                                                 |
   | `CRON_SECRET`                   | stringa casuale lunga (`openssl rand -hex 32`)                                                                                                 |
   | `EMAIL_PROVIDER`                | `brevo` (consigliato) o `resend`; vuota = si sceglie da sé in base alle chiavi                                                                 |
   | `BREVO_API_KEY`                 | chiave API di Brevo, scheda **API Keys** (vuota = email saltate)                                                                               |
   | `RESEND_API_KEY`                | solo se usi Resend: chiave Resend                                                                                                              |
   | `EMAIL_FROM`                    | mittente **verificato** sul provider, es. `SuperLega <lega@tuodominio.it>`                                                                     |
   | `QUOTATIONS_SOURCE_URL`         | **vuota** finché non verifichi Fantacalcio.it (docs/SYNC.md)                                                                                   |
   | `AVAILABILITY_PROVIDER`         | `bsd` (consigliato) oppure `api-football`                                                                                                      |
   | `BSD_API_KEY`                   | chiave di bigballsdata.com, piano gratuito (vuota = feed spento)                                                                               |
   | `BSD_BASE_URL`                  | **facoltativa**: altro indirizzo base, default `https://api.bigballsdata.com`                                                                  |
   | `BSD_LEAGUE`                    | **facoltativa**: come il fornitore chiama la Serie A — in produzione è `seriea`; se l'API la rifiuta, il job la cerca da solo in `/v1/leagues` |
   | `BSD_SPORT`                     | **facoltativa**: lo sport come lo chiama il fornitore, default `football` (in alternativa prova `soccer` da solo)                              |
   | `API_FOOTBALL_KEY`              | solo se usi `api-football`: chiave di api-sports.io                                                                                            |
   | `API_FOOTBALL_SEASON`           | **facoltativa**: solo con `api-football`, per forzare la stagione                                                                              |

   Il piano **gratuito di API-Football non copre la stagione in corso**
   ("Free plans do not have access to this season, try from 2022 to 2024"):
   per questo il fornitore predefinito è **`bsd`** (Big Balls Sports Data,
   gratuito, senza carta, ~1000 richieste al giorno). Dettagli e procedura di
   verifica in docs/SYNC.md.

3. **Branch di produzione**: se il repository ha come branch predefinito uno
   diverso da `main`, in Vercel vai su _Settings → Environments → Production →
   Branch Tracking_ e scrivi `main`; il primo deploy parte al primo push su
   `main` (o da _Deployments → Create Deployment_).
   **Attenzione**: i deploy fatti da altri branch sono _Preview_ e non toccano
   l'URL pubblico. Se cambi una variabile `NEXT_PUBLIC_*` fai il _Redeploy_
   di un deploy con etichetta **Production** (filtro _Environment → Production_
   nella pagina Deployments), oppure fai un push su `main`: solo così il nuovo
   valore entra nella build che serve il sito.
4. **Deploy**. Il cron in `vercel.json` (`30 4 * * *`, una volta al giorno come
   consente Hobby) chiama `/api/cron/sync-quotations` con `CRON_SECRET`:
   fa da keep-alive per Supabase Free (che altrimenti si pausa dopo 7 giorni
   di inattività) e, se configurata una sorgente, importa le quotazioni.
5. **Feed indisponibili/formazioni ogni 15 minuti (da fare una volta)**. Il
   piano Hobby dà **un solo cron al giorno**, già usato per le quotazioni: la
   pianificazione del feed sta quindi su Supabase, con pg_cron + pg_net, e
   **non è attiva finché non la esegui tu**.
   - Apri Supabase → _SQL Editor → New query_, incolla
     `supabase/deploy/updates/2026-09-11-availability-cron.sql`, sostituisci i
     due segnaposto `<SITO>` (l'URL pubblico dell'app, senza barra finale) e
     `<CRON_SECRET>` (lo stesso valore messo su Vercel) e premi **Run**.
   - In sintesi il file fa questo:

     ```sql
     create extension if not exists pg_cron;
     create extension if not exists pg_net;
     select cron.schedule(
       'superlega-availability',
       '*/15 * * * *',
       $$select net.http_get(
          url := '<SITO>/api/cron/sync-availability',
          headers := jsonb_build_object('Authorization', 'Bearer <token di Admin → Indisponibili>')
        );$$
     );
     ```

   - Per annullare: `select cron.unschedule('superlega-availability');`
   - Verifica: `select * from cron.job;`, poi in _Admin → Indisponibili_ che
     "Ultimo aggiornamento" si muova. Senza la chiave del fornitore
     (`BSD_API_KEY`) il job gira ma non fa nulla (nessun errore).
   - Anche senza pianificazione il feed si aggiorna da solo quando qualcuno
     apre l'app e sono passati più di 15 minuti dall'ultima volta: la
     pianificazione serve perché le formazioni siano pronte anche se nessuno
     sta guardando.
6. Dominio personalizzato (facoltativo): _Settings → Domains_; aggiorna poi
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
- **Brevo gratuito**: 300 email/giorno complessive, condivise tra le email di
  Auth (SMTP) e quelle di lega (API); mittente verificato necessario.
- **Resend Free** (alternativa): 100 email/giorno, 3.000/mese; dominio
  verificato necessario per inviare a indirizzi diversi dal tuo.
- **API-Football Free**: 100 richieste al giorno. Il feed ne usa al massimo 3 per
  esecuzione (2 quando non c'è una partita imminente): con il job ogni 15 minuti
  il consumo tipico sta dentro la quota, ma nei giorni di campionato va tenuto
  d'occhio (la quota residua è scritta in _Admin → Indisponibili_). Se si
  esaurisce, allunga l'intervallo del job (docs/SYNC.md).
- **pg_cron/pg_net su Supabase Free**: inclusi, vanno abilitati una volta (§3.5).

## 8. Aggiornamenti

Ogni push sul branch principale rideploya l'app. Nuove migrazioni, **prima**
del deploy che le usa:

- con la CLI: `supabase db push`;
- senza CLI (Opzione A): apri il nuovo file in `supabase/migrations/`, copia
  tutto il contenuto e incollalo in _SQL Editor → New query → Run_. Ogni
  migrazione va eseguita **una volta sola**, in ordine di nome; il file
  `supabase/deploy/schema.sql` serve solo per il primo avvio da zero. Quando
  un aggiornamento porta più migrazioni insieme, in `supabase/deploy/updates/`
  c'è un unico file già concatenato da incollare.

Le migrazioni non si modificano dopo l'applicazione: si aggiunge un nuovo file.
