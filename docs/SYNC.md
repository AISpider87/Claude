# Sync automatico delle quotazioni

## Come funziona

- Job giornaliero: **Vercel Cron** chiama `GET /api/cron/sync-quotations` alle
  **04:30 UTC** (06:30 in ora legale, 05:30 in ora solare) con
  `Authorization: Bearer $CRON_SECRET`. Il piano Hobby consente una sola
  esecuzione al giorno per job, quindi l'orario non segue il DST: è sempre prima
  che qualcuno apra l'app.
- Il job usa la **chiave service-role** (solo lato server) e:
  1. fa una query minima (**keep-alive** del progetto Supabase Free, che altrimenti
     si mette in pausa dopo ~7 giorni di inattività);
  2. se `sync_enabled` è vero e una sorgente è configurata, scarica il file,
     lo analizza con lo **stesso parser** dell'upload manuale, salva un import
     `source = auto` con anteprima e lo applica;
  3. registra sempre l'esito in `imports` (anche i fallimenti), visibile in
     Admin → Listone.
- Sorgente = `QuotationSource` (pluggable). Implementazioni: `none` (default) e
  `http` (`QUOTATIONS_SOURCE_URL`, opzionale `QUOTATIONS_SOURCE_COOKIE`).
  Regole di cortesia: 1 richiesta al giorno, user-agent identificato
  (`SuperLega/1.0`), un solo secondo tentativo, timeout 20 s, massimo 5 MB,
  rifiuta risposte che non sono un `.xlsx` (es. pagina di login).

## Stato della verifica su Fantacalcio.it

Dall'ambiente di sviluppo il dominio `fantacalcio.it` **non è raggiungibile**
(proxy di rete), quindi URL di download, necessità di login, `robots.txt` e
termini d'uso **non sono ancora stati verificati**. Da fare in Fase 3, dal
computer dell'admin:

1. Aprire la pagina "Quotazioni Fantacalcio", scaricare l'Excel e annotare
   l'URL effettivo della richiesta (strumenti sviluppatore → Rete).
2. Controllare `https://www.fantacalcio.it/robots.txt` e i termini d'uso: se
   il download automatico non è consentito, **non configurare la sorgente** e
   restare sull'upload manuale (percorso garantito, stesso parser, anteprima).
3. Se consentito e l'URL funziona senza login: impostare `QUOTATIONS_SOURCE_URL`
   su Vercel. Se serve la sessione: `QUOTATIONS_SOURCE_COOKIE` (scade: da
   rinnovare) — oppure lasciare tutto manuale.
4. Premere **Esegui ora** in Admin → Listone per verificare, poi controllare
   il log degli import.

## Fallback garantito

L'upload manuale dell'admin (Admin → Listone → Nuovo import) resta sempre
disponibile e produce lo stesso risultato: anteprima delle differenze, poi
conferma. Se il sync automatico fallisce per più giorni, l'admin lo vede nel
pannello e può caricare il file a mano.

# Indisponibili e titolarità (feed automatico)

## Fornitore e contratto

- **API-Football** (api-sports.io), host diretto `https://v3.football.api-sports.io`,
  header `x-apisports-key`. **Non** la variante RapidAPI. Piano **gratuito**
  (0 €): 100 richieste al giorno.
- Lega Serie A = `league=135`. La stagione è l'**anno d'inizio** (2026/27 →
  `2026`): non è scritta nel codice, si ricava dalla data (mese ≥ 7 → anno
  corrente, altrimenti anno − 1) e si può forzare con `API_FOOTBALL_SEASON`.
- Endpoint usati (`src/lib/availability/provider.ts`):
  | Chiamata                                             | Quando                                     | Cosa se ne ricava                                 |
  | ---------------------------------------------------- | ------------------------------------------ | ------------------------------------------------- |
  | `GET /injuries?league=135&season=<stagione>`         | ogni esecuzione                            | indisponibili con `player.type` e `player.reason` |
  | `GET /fixtures?league=135&season=<stagione>&next=10` | ogni esecuzione                            | prossime partite con orario e stato               |
  | `GET /fixtures/lineups?fixture=<id>`                 | **solo** se una partita inizia entro 3 ore | titolari e panchinari                             |
- **Budget: 3 richieste per esecuzione**, imposto da `RequestBudget` (il
  provider rifiuta la quarta chiamata invece di farla). Senza partite imminenti
  le richieste sono 2 e la chiamata formazioni non parte affatto.
- Ogni risposta ha un campo `errors`: se non è vuoto la chiamata è considerata
  fallita e il messaggio del fornitore viene riportato **alla lettera** in
  Admin → Indisponibili (casi tipici: chiave sbagliata, limiti di piano,
  stagione non coperta dal piano gratuito). Si legge anche
  `x-ratelimit-requests-remaining` per mostrare la quota residua.

## Cadenza

- **pg_cron + pg_net su Supabase**, ogni 15 minuti, chiama
  `GET /api/cron/sync-availability` con `Authorization: Bearer $CRON_SECRET`.
  Il piano Hobby di Vercel dà un solo cron al giorno, già speso per le
  quotazioni. **Va attivato una volta a mano**: istruzioni e SQL in
  `supabase/deploy/updates/2026-09-11-availability-cron.sql` (docs/DEPLOY.md §3).
- **Rete di sicurezza**: ogni pagina autenticata, in background (`after()`),
  chiede al database `claim_availability_refresh(900)`. Se nessuno aggiorna il
  feed da più di 15 minuti, quella singola visita lancia l'aggiornamento. La
  "prenotazione" è un unico upsert atomico su `league_settings`, quindi due
  visite simultanee non possono mai lanciare due esecuzioni.

## Abbinamento dei nomi

L'API e il listone non hanno un id in comune: l'API dice "Lautaro Martinez ·
Internazionale", il listone dice "Martinez Lau. · Inter".

1. Si guarda prima `external_player_map` (l'abbinamento già noto): se c'è, si usa.
2. Altrimenti si prova il nome esatto (`NameMatcher`, normalizzato senza accenti
   né maiuscole), **verificando il club**; i nomi di club dell'API sono
   ricondotti a quelli del listone (Internazionale→Inter, AC Milan→Milan,
   AS Roma→Roma, SSC Napoli→Napoli…).
3. Altrimenti si cerca il cognome **dentro il club** (dall'ultimo token del nome
   API all'indietro).
4. **Un solo candidato nel club giusto** → abbinamento `auto`, salvato per le
   volte successive. **Più candidati o nessuno** → non si applica niente e il
   nome finisce nell'elenco "Nomi da abbinare" della pagina admin, dove l'admin
   sceglie il calciatore giusto (`admin_confirm_player_map`, confidenza
   `confirmed`: il feed non la tocca più).

Meglio uno stato mancante che uno stato sbagliato sulla rosa di qualcuno.

## Mappatura degli stati

| Testo dell'API                                            | Stato salvato                 |
| --------------------------------------------------------- | ----------------------------- |
| `reason` contiene "Suspended", "Red Card", "Yellow Cards" | `suspended` (Squalificato)    |
| `type` = "Questionable"                                   | `doubtful` (In dubbio)        |
| `reason` contiene "Coach Decision", "National…"           | `unavailable` (Indisponibile) |
| tutto il resto                                            | `injured` (Infortunato)       |

Se lo stesso calciatore compare più volte (più partite), vince il più grave.
La nota mostrata è il `reason` originale. Fonte: "API-Football".

## Il manuale batte il feed

`player_status.origin` vale `manual` o `feed`. Le righe scritte dall'admin
(Admin → Indisponibili) sono `manual` e **non vengono mai sovrascritte né
cancellate** dal feed. Le righe `feed` vengono riscritte a ogni esecuzione e
spariscono quando l'API smette di segnalarle — ma **solo se la chiamata è
riuscita**: dopo un errore non si cancella niente, altrimenti un guasto del
fornitore si leggerebbe come "sono guariti tutti".

## Senza chiave (o con chiave sbagliata)

- **`API_FOOTBALL_KEY` assente**: il feed è semplicemente spento. Nessuna
  chiamata di rete, nessun errore, il pulsante "Aggiorna adesso" lo dice e
  restano gli stati manuali, che funzionano esattamente come prima.
- **Chiave sbagliata, quota finita, stagione non coperta**: la chiamata
  fallisce, il messaggio dell'API compare **alla lettera** nel pannello admin,
  nessuna riga viene toccata (niente cancellazioni) e l'esecuzione successiva
  riprova.
- **`SUPABASE_SERVICE_ROLE_KEY` assente**: `sync_availability` è riservata al
  service role, quindi il feed non scrive; il pannello lo segnala.

## Da verificare in produzione

Dall'ambiente di sviluppo `api-sports.io` **non è raggiungibile** (proxy di
rete): il codice è stato scritto e testato su fixture scritte a mano seguendo la
documentazione v3 (`tests/fixtures/api-football-*.json`). Alla prima esecuzione
vera, in Admin → Indisponibili, l'admin deve controllare:

1. che `errors` sia vuoto (altrimenti il messaggio dice cosa manca: chiave,
   piano, stagione);
2. che la stagione **2026** sia coperta dal piano gratuito (alcuni piani
   gratuiti coprono solo stagioni passate: in quel caso si imposta
   `API_FOOTBALL_SEASON`);
3. che i nomi dei club dell'API siano quelli previsti (l'elenco "Nomi da
   abbinare" pieno di giocatori di un solo club = alias di club mancante);
4. che `/injuries` restituisca davvero righe per la Serie A (su alcuni piani
   l'endpoint è vuoto: in quel caso restano le formazioni e gli stati manuali);
5. che `x-ratelimit-requests-remaining` scenda come previsto e non si avvicini
   a zero (in quel caso allungare l'intervallo del job).
