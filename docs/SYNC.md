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

## Due fornitori, un solo contratto

Il feed è **pluggable**: `AvailabilityProvider`
(`src/lib/availability/shared.ts`) è l'unica interfaccia che il job conosce, e
`availabilityProviderFromEnv()` sceglie l'implementazione in base a
`AVAILABILITY_PROVIDER`:

| Valore                  | Fornitore                                      | Piano gratuito                           |
| ----------------------- | ---------------------------------------------- | ---------------------------------------- |
| `bsd` (**predefinito**) | Big Balls Sports Data (`api.bigballsdata.com`) | senza carta, ~1000 richieste/giorno      |
| `api-football`          | API-Football (`v3.football.api-sports.io`)     | 100 richieste/giorno, **solo 2022-2024** |

Senza `AVAILABILITY_PROVIDER` vince `bsd` se c'è `BSD_API_KEY`, altrimenti
`api-football` se c'è `API_FOOTBALL_KEY`, altrimenti **il feed è spento** e
restano gli stati manuali.

**Perché non API-Football**: il suo piano gratuito risponde _"Free plans do not
have access to this season, try from 2022 to 2024"_ per la Serie A 2026/27.
Resta nel codice (funziona a pagamento e sulle stagioni passate), ma non è più
il predefinito. Vedi docs/DECISIONS.md.

Variabili d'ambiente:

| Variabile               | A cosa serve                                                 |
| ----------------------- | ------------------------------------------------------------ |
| `AVAILABILITY_PROVIDER` | `bsd` o `api-football`                                       |
| `BSD_API_KEY`           | chiave BSD (vuota = feed spento)                             |
| `BSD_BASE_URL`          | facoltativa, default `https://api.bigballsdata.com`          |
| `BSD_LEAGUE`            | facoltativa, default `serie-a`; accetta anche un id numerico |
| `API_FOOTBALL_KEY`      | chiave api-sports.io (solo con `api-football`)               |
| `API_FOOTBALL_SEASON`   | facoltativa, forza la stagione                               |

La chiave **non compare mai** in un URL, in un log, in un errore o nella
risposta grezza mostrata all'admin: viaggia solo negli header
(`Authorization: Bearer …` **e** `x-api-key` per BSD — quale dei due voglia il
fornitore non è verificato, mandarli entrambi è innocuo;
`x-apisports-key` per API-Football).

## BSD: come si trova la rotta giusta

I percorsi esatti dell'API BSD **non erano verificati** (il dominio non è
raggiungibile dall'ambiente di sviluppo) e la prima esecuzione vera ha infatti
risposto `404` a tutti i candidati — ma con un corpo utilissimo:

```json
{
  "error": {
    "code": "route_not_found",
    "message": "No route: GET /v1/football/injuries?league=serie-a."
  },
  "suggested_fix": "No such route. Browse every endpoint at GET /v1/ or the OpenAPI spec at GET /openapi.json."
}
```

È il fornitore stesso a dire dove sta l'elenco delle sue rotte. L'ordine dei
tentativi, per ogni capacità, è quindi:

1. **la rotta memorizzata** dall'ultima volta (`league_settings.availability_endpoints`);
2. il **primo candidato statico** della lista qui sotto;
3. **l'elenco delle rotte del fornitore**: `GET /openapi.json`, e se non
   risponde `GET /v1/` (una sola volta per esecuzione, qualunque sia il numero
   di capacità);
4. la **rotta scelta** in quell'elenco per questa capacità;
5. i **candidati statici rimanenti**, per il caso in cui non ci sia nessun
   elenco da leggere.

Al primo `200` con JSON valido ci si ferma.

### Candidati statici

I primi di ogni elenco sono le **rotte vere**, lette dall'elenco del fornitore
il 2026-09-11; gli altri restano come rete di sicurezza.

| Capacità      | Candidati provati in ordine                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| indisponibili | `/v1/injuries?sport=…&league=…` · `/v1/injuries?league=…` · poi i vecchi tentativi (`/v1/football/injuries`, `/football/injuries`, `/v1/soccer/injuries`, `/injuries`) |
| calendario    | `/v1/matches?league=…&status=upcoming` · `/v1/matches?sport=…&league=…` · poi i vecchi tentativi                                                                       |
| formazioni    | `/v1/stored_matches/<id>/lineups` · `/v1/live-stats/<sport>/<id>/players` · poi i vecchi tentativi                                                                     |

**Non** esiste `/v1/matches/{id}/lineups`: le formazioni stanno sotto
`stored_matches`, i giocatori in campo sotto `live-stats`.

### Scelta della rotta nell'elenco

`src/lib/availability/bsd-discovery.ts` trasforma il documento in un elenco
piatto di rotte `GET` con i loro parametri. Sono accettati: un documento
**OpenAPI** (oggetto `paths`), un array di stringhe (`"GET /v1/x"` o `"/v1/x"`),
`{routes:[…]}`, `{endpoints:[…]}`, o un oggetto con i percorsi come chiavi.
Formato non riconosciuto → nessuna scoperta, si torna ai candidati statici.

Il punteggio di ogni rotta `GET`:

| Capacità      | Parole cercate nel percorso                                         |
| ------------- | ------------------------------------------------------------------- |
| indisponibili | `injur`; in mancanza `unavailab`, `sideline`, `absence`, `absent`   |
| calendario    | `fixture`, `match`, `schedule`; in mancanza `game`, `calendar`      |
| formazioni    | `lineup`, `line-up`, `formation`, `squad`; poi `starting`, `eleven` |

Bonus a chi contiene anche `football`/`soccer` o dichiara un parametro di lega;
malus ai percorsi con segnaposto `{…}` (per le formazioni invece un segnaposto
tipo `{fixtureId}` è **richiesto**: senza, la rotta non saprebbe di quale partita
parlare e viene scartata). Le rotte non `GET` non vengono mai scelte.

### Nomi dei parametri (dal documento, non indovinati)

| Il nostro concetto | Primo nome dichiarato fra                                                                |
| ------------------ | ---------------------------------------------------------------------------------------- |
| lega               | `league`, `league_id`, `leagueId`, `competition`, `competition_id`, `tournament`, `slug` |
| stagione           | `season`, `season_id`, `year` — **inviata solo se dichiarata**                           |
| partita            | il segnaposto del percorso, oppure `fixture`, `fixture_id`, `match`, `match_id`          |
| stato/prossime     | `status`, `state` — solo se dichiarati (valore `upcoming`)                               |

Se il documento dichiara un **enum** per il parametro della lega e il valore
configurato (`BSD_LEAGUE`) non è fra quelli, si usa la voce dell'enum che
somiglia a "serie a" (es. `serie-a` → `it-serie-a`) e la sostituzione viene
scritta nel riepilogo dell'esecuzione.

### Correzioni automatiche (400, lega, sport)

Il fornitore dice cosa manca: `/v1/injuries` chiamata senza parametri risponde
`400` con `{"error":{"message":"sport or league query param is required"}}`.
Ogni chiamata può quindi correggersi da sola, **una volta per tipo di
correzione**, contando ogni tentativo nel budget e registrandolo nella risposta
grezza:

1. **parametri obbligatori**: dal messaggio del `400` si leggono i nomi
   (`sport or league query param is required`, `Missing required parameter: x`,
   `league and season parameters are required`) e si riprova la stessa rotta con
   quei parametri, riempiti con quello che sappiamo (sport, lega, stagione,
   partita);
2. **lega sbagliata** (400 che non chiede parametri, o `200` senza righe):
   `GET /v1/leagues?sport=<sport>` una sola volta per esecuzione, si cerca la
   voce che si legge come "serie a" (preferendo quella italiana) e si riprova
   con il suo id;
3. **sport sbagliato**: si riprova una volta con `football` al posto di
   `soccer` (o viceversa).

Il set di parametri che ha funzionato, la lega e lo sport accettati finiscono
nella cache: le correzioni si pagano una volta sola.

### Cache e budget

- Rotta scelta, nomi dei parametri ed eventuale valore di lega sostituito
  finiscono in `league_settings.availability_endpoints`
  (`save_availability_diagnostics`, riservata al service role), sotto la chiave
  `routes`, insieme alla lega (`league`) e allo sport (`sport`) che l'API ha
  accettato; i vecchi candidati salvati (`{"injuries": "/…"}`) continuano a
  essere letti. **Dalla esecuzione successiva si va dritti alla rotta**: una
  richiesta per capacità, zero per la scoperta. Una sola lettura e al massimo
  una scrittura di impostazioni per esecuzione.
- Se la rotta memorizzata comincia a rispondere `404`, viene dimenticata e la
  scoperta riparte da sola.
- Se **niente** risponde, l'esecuzione fallisce con `endpoint non trovato`
  seguito dagli stati provati (`/v1/football/injuries → HTTP 404 · …`), non
  viene cancellato nessuno stato e le risposte grezze — scoperta compresa —
  restano a disposizione dell'admin.
- Budget: **16 richieste** per esecuzione con BSD (basta a provare tutti i
  candidati _e_ la scoperta la prima volta; a regime sono 2-3), **3** con
  API-Football.

## BSD: la forma vera del payload

Le prime esecuzioni con `200` hanno mostrato che la forma non è quella che
immaginavamo. Questo è il payload vero degli **indisponibili**
(`GET /v1/injuries?sport=football&league=seriea`):

```json
{
  "data": {
    "injuries": {
      "value": [
        {
          "id": "bb_player_nuflljaiugdf",
          "sport": "football",
          "full_name": "L. Balerdi",
          "display_name": "L. Balerdi",
          "current_team_id": "bb_team_yl4g3x6vrnn6"
        }
      ]
    }
  }
}
```

Quattro cose da leggere qui dentro, tutte gestite:

1. **le righe stanno in `data.<capacità>.value`** — un involucro per capacità
   più un `value`. Il lettore scende quindi dentro gli involucri: chiavi note
   (`data`, `response`, `results`, `items`, `rows`, `records`, `matches`,
   `fixtures`, `injuries`, `players`, `lineups`, `events`), poi un
   `value`/`values`/`items`/`list`/`records`, poi qualunque oggetto con **una
   sola chiave**, fino a tre livelli.
2. **il nome è abbreviato**: "L. Balerdi", non "Leonardo Balerdi" — vedi
   "Abbinamento dei nomi" più sotto.
3. **il club è un id opaco** `current_team_id: "bb_team_…"`, mai un nome: si
   traduce con `GET /v1/teams?sport=<sport>&league=<lega>` (ripiego
   `?league=<lega>`), una volta per esecuzione, con una sola ripetizione se
   salta fuori un id sconosciuto; la mappa `id → nome` è memorizzata in
   `league_settings.availability_endpoints` sotto `teams`, insieme alla lega e
   allo sport per cui vale (se cambiano, si rifà). Se l'elenco non risponde, la
   riga **non si butta**: si abbina senza club e l'abbinamento resta **da
   confermare**.
4. **lo stato può non esserci affatto**: una riga che arriva dall'endpoint
   _indisponibili_ è comunque un'assenza, quindi senza testo riconoscibile vale
   `injured` e il pannello scrive "N righe senza stato: considerate
   infortunate". Solo una riga **senza nome** è illeggibile.

L'id del calciatore è anch'esso opaco (`bb_player_…`): siccome
`external_player_map.external_id` è un intero, la stringa viene ridotta a un
intero stabile (FNV-1a a 31 bit), così l'admin può comunque confermare
l'abbinamento una volta per tutte.

Il **calendario** (`GET /v1/matches`) ha risposto 200 con 50 righe e queste
chiavi: `id, sport, league, home, away, kickoff_utc, status, score, linescore,
attendance, broadcast, round, has_odds`. Il campo dell'orario è `kickoff_utc`,
che prima non conoscevamo: nessuna riga passava.

### Come vengono letti i campi

Ogni nome è cercato **ignorando maiuscole, trattini e underscore** (`home_team`,
`homeTeam` e `HomeTeam` sono la stessa cosa), con percorsi puntati
(`teams.home.name`) e indici (`competitors[0]`). Un campo che contiene un
oggetto viene letto dal suo `name` / `display_name` / `full_name` /
`short_name` / `abbreviation`.

- **Id della partita**: `id` | `match_id` | `fixture_id` | `game_id` |
  `event_id` | `uuid` (ci serve **numerico**: un id testuale non è memorizzabile
  e la riga viene saltata).
- **Calcio d'inizio**: `kickoff_utc` | `kickoff_time_utc` | `start_utc` |
  `date_utc` | `commence_time_utc` | `utc` | `start_time` | `commence_time` |
  `scheduled` | `scheduled_at` | `kickoff` | `date` | `datetime` | `start` |
  `starts_at`; stringa ISO **oppure** epoch in secondi o millisecondi.
- **Stato della partita**: `status` | `state` | `match_status`, stringa oppure
  oggetto (`status.short`, `status.long`, `status.type`, `status.state`).
- **Squadre**: `home` | `home_team` | `teams.home` | `competitors[0]` (e gli
  equivalenti away), stringa oppure oggetto.
- **Nome del calciatore**: `player` | `player_name` | `athlete` | `name` |
  `full_name` | `display_name`.
- **Club**: `team` | `team_name` | `club` | `squad` per il nome;
  `current_team_id` | `team_id` | `club_id` per l'id da tradurre.
- **Stato**: `status` | `type` | `injury_status` | `availability` |
  `designation` | `reason` | `description` | `detail` | `note` | `comment` |
  `injury`.
- **Rientro previsto**: `expected_return` | `return_date` | `until` | `eta`
  (finisce nella nota, non nella logica).
- **Formazioni**: una riga per squadra con `startXI` / `starting_xi` /
  `starters` / `lineup` / `starting_lineup` e `substitutes` / `subs` / `bench`
  (le voci possono essere oggetti o nomi nudi), **oppure** una riga per
  calciatore con `is_starter` / `starter` / `starting` / `start` /
  `lineup: "start"`. Una riga senza nessuna delle due cose viene saltata: non si
  dà del titolare a nessuno per esclusione.

Ogni capacità scrive sempre nel pannello quante righe ha ricevuto e quante ne ha
lette; se ne ha lette **zero**, elenca anche le chiavi della prima riga:

```
indisponibili: 37 righe ricevute, 37 lette
calendario: 50 righe ricevute, 0 lette
calendario: nessuna riga leggibile · chiavi della prima riga: id, sport, league, home, away, kickoff_utc, status, score, linescore, attendance, broadcast, round, has_odds
```

È la riga che risolve il problema in un colpo solo: dice i nomi veri dei campi.

### Parole chiave → stato salvato (BSD)

| Il testo dello stato contiene…                                        | Stato salvato                    |
| --------------------------------------------------------------------- | -------------------------------- |
| `squalif`, `suspen`, `sospen`, `ban`                                  | `suspended` (Squalificato)       |
| `infort`, `injur`, `knock`, `strain`, `sprain`, `fracture`, `surgery` | `injured` (Infortunato)          |
| `dubbio`, `doubt`, `question`, `probable`, `50-50`, `game-time`       | `doubtful` (In dubbio)           |
| qualunque altro testo non vuoto                                       | `unavailable` (Indisponibile)    |
| vuoto o illeggibile                                                   | **riga saltata** (non applicata) |

L'ordine conta: una squalifica non è un infortunio anche se il testo cita
entrambi. Fonte mostrata al manager: "Big Balls Sports Data".

### Mappatura degli stati (API-Football)

| Testo dell'API                                            | Stato salvato                 |
| --------------------------------------------------------- | ----------------------------- |
| `reason` contiene "Suspended", "Red Card", "Yellow Cards" | `suspended` (Squalificato)    |
| `type` = "Questionable"                                   | `doubtful` (In dubbio)        |
| `reason` contiene "Coach Decision", "National…"           | `unavailable` (Indisponibile) |
| tutto il resto                                            | `injured` (Infortunato)       |

Se lo stesso calciatore compare più volte (più partite), vince il più grave.

## Diagnostica: "Mostra risposta grezza"

Siccome dall'ambiente di sviluppo **non si raggiunge né bigballsdata.com né
api-sports.io**, la forma vera del payload si scopre in produzione. Per farlo in
un giro solo, in _Admin → Indisponibili_:

1. spunta **"Modalità diagnostica"** accanto a **"Aggiorna adesso"** e premi il
   pulsante: le risposte grezze vengono salvate anche se l'aggiornamento
   riesce (dopo un errore vengono salvate comunque);
2. apri **"Mostra risposta grezza"**: per ogni chiamata compaiono la capacità
   (`injuries`/`fixtures`/`lineups`, più `discovery` per l'elenco delle rotte),
   l'URL, il codice HTTP e i **primi 1500 caratteri** del corpo, più l'elenco
   dei percorsi e delle rotte che hanno risposto;
3. se i dati non arrivano, quel testo dice esattamente cosa correggere: i
   candidati in `BSD_CANDIDATES` o i nomi dei campi in
   `src/lib/availability/bsd.ts` (e le fixture in `tests/fixtures/bsd-*.json`).

Dove finiscono: `league_settings.availability_last_samples`, **leggibile solo
dall'admin** (la tabella ha una policy admin-only dalla M1) e scrivibile solo
dal service role. Sono **al massimo 4 KB** in tutto e la chiave viene tolta
prima del salvataggio (sostituzione esatta della chiave configurata, più una
regex su `key=`, `token:`, `Bearer …` e su qualunque stringa opaca lunga).
Il pannello mostra anche quante righe sono arrivate ma **non sono state
leggibili**: se quel numero è alto, i nomi dei campi sono sbagliati.

Sopra la risposta grezza compare la riga **"Rotte del fornitore"**, per esempio:

```
rotte trovate: 34 da /openapi.json · scelte: /v1/soccer/injuries (league_id), /v1/soccer/fixtures (league_id, season, status)
lega non accettata dalla rotta /v1/soccer/injuries: "serie-a" sostituita con "it-serie-a"
nessuna rotta per formazioni: cercate lineup, line-up, line_up, formation, squad, starting, eleven
```

L'ultima riga è quella da rimandare a chi sviluppa insieme all'elenco delle
rotte: dice esattamente quali parole sono state cercate e non trovate.

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

Nessun fornitore ha un id in comune con il listone: l'API dice "Lautaro
Martinez · Internazionale", il listone dice "Martinez Lau. · Inter".

1. Si guarda prima `external_player_map` (l'abbinamento già noto, per fornitore):
   se c'è, si usa.
2. Altrimenti si prova il nome esatto (`NameMatcher`, normalizzato senza accenti
   né maiuscole), **verificando il club**; i nomi di club dell'API sono
   ricondotti a quelli del listone (Internazionale→Inter, AC Milan→Milan,
   AS Roma→Roma, SSC Napoli→Napoli…).
3. Altrimenti si cerca il cognome **dentro il club** (dall'ultimo token del nome
   API all'indietro).
4. Altrimenti, **solo il cognome**: BSD scrive "L. Balerdi", il listone scrive
   "Balerdi". L'iniziale puntata iniziale viene tolta e si cerca il cognome
   rimasto — unico **dentro il club** se il club si conosce, unico **in tutta la
   lega** se non si conosce. Un abbinamento trovato così (o trovato senza poter
   verificare il club) **viene applicato ma non memorizzato**: compare fra i
   "Nomi da abbinare" come **da confermare**, con il calciatore già proposto.
   Basta un clic per renderlo definitivo.
5. **Un solo candidato nel club giusto** → abbinamento `auto`, salvato per le
   volte successive. **Più candidati o nessuno** → non si applica niente e il
   nome finisce nell'elenco "Nomi da abbinare" della pagina admin, dove l'admin
   sceglie il calciatore giusto (`admin_confirm_player_map`, confidenza
   `confirmed`: il feed non la tocca più).

Meglio uno stato mancante che uno stato sbagliato sulla rosa di qualcuno.
Nota: gli abbinamenti sono **per fornitore**, quindi cambiando fornitore
l'elenco "Nomi da abbinare" riparte da zero.

## Il manuale batte il feed

`player_status.origin` vale `manual` o `feed`. Le righe scritte dall'admin
(Admin → Indisponibili) sono `manual` e **non vengono mai sovrascritte né
cancellate** dal feed. Le righe `feed` vengono riscritte a ogni esecuzione e
spariscono quando l'API smette di segnalarle — ma **solo se la chiamata è
riuscita**: dopo un errore non si cancella niente, altrimenti un guasto del
fornitore si leggerebbe come "sono guariti tutti".

## Senza chiave, o quando il fornitore non risponde (fallback garantito)

- **Nessuna chiave configurata**: il feed è semplicemente spento. Nessuna
  chiamata di rete, nessun errore; il pannello lo dice indicando **quale**
  variabile manca e restano gli stati manuali, che funzionano esattamente come
  prima. Questo è il percorso garantito: la lega può vivere tutta la stagione di
  soli stati manuali.
- **Chiave sbagliata, quota finita, endpoint sbagliato**: la chiamata fallisce,
  il messaggio del fornitore compare **alla lettera** nel pannello, la risposta
  grezza viene salvata, nessuna riga viene toccata e l'esecuzione successiva
  riprova.
- **`SUPABASE_SERVICE_ROLE_KEY` assente**: `sync_availability` è riservata al
  service role, quindi il feed non scrive; il pannello lo segnala.

## Verificato in produzione, e cosa resta da verificare (BSD)

**Verificato l'11 settembre 2026**, tre esecuzioni vere con la chiave
dell'admin:

- indirizzo base `https://api.bigballsdata.com`, **chiave valida** (quota
  dichiarata: 93 → 82 → 91 richieste residue);
- nessuno dei percorsi indovinati esisteva (`404 route_not_found`), ma il corpo
  indicava `GET /v1/` e `GET /openapi.json`: **la scoperta funziona** e ha
  restituito **125 rotte** ("Big Ball Sports API"; ogni risposta porta un
  punteggio di confidenza e l'attribuzione della fonte; paginazione con
  `?limit=` / `?offset=` / `?page=`);
- `GET /v1/injuries` senza parametri risponde `400`
  `"sport or league query param is required"` → correzione automatica;
- **lo sport che funziona è `football`**, non `soccer`;
- **la Serie A si chiama `seriea`** (senza trattino): trovata da
  `GET /v1/leagues?sport=football`, che risponde
  `{"data":[{"id":"epl",…},{"id":"seriea","name":"Serie A","sport":"football","country":"italy"}…]}`;
- con `sport=football&league=seriea` **entrambe le chiamate rispondono `200`**:
  indisponibili e `/v1/matches` (50 righe);
- la forma delle righe è quella descritta sopra (`data.<capacità>.value`,
  `full_name` abbreviato, `current_team_id` opaco, `kickoff_utc`);
- le rotte utili per il calcio, alla lettera: `/v1/injuries`, `/v1/matches`,
  `/v1/matches/{id}` (+ `events`, `odds`, `statistics`, `weather`),
  `/v1/live-stats/{sport}/{matchId}/players`, `/v1/stored_matches`,
  `/v1/stored_matches/{id}` (+ `lineups`, `plays`, `stats`),
  `/v1/stored_players`, `/v1/stored_standings`, `/v1/leagues`,
  `/v1/leagues/{id}`, `/v1/players`, `/v1/players/{id}` (+ `profile`),
  `/v1/teams`, `/v1/teams/{id}` (+ `season`, `stats`), `/v1/sports`,
  `/v1/coverage`. **Le formazioni stanno sotto `stored_matches`**, non sotto
  `matches`.

**Resta da verificare al prossimo aggiornamento** (modalità diagnostica accesa):

1. che gli indisponibili arrivino davvero sulle rose: guarda le righe
   "indisponibili: N righe ricevute, N lette" e "abbinamenti: N riusciti, M da
   confermare";
2. che `GET /v1/teams?sport=football&league=seriea` risponda: senza la mappa dei
   club tutti gli abbinamenti restano "da confermare" (e il pannello lo scrive);
3. **i cognomi**: conferma le righe "da confermare" una volta — da lì in poi
   l'abbinamento è memorizzato e non viene più indovinato;
4. se qualche riga resta illeggibile, la nota con le **chiavi della prima riga**
   dice quali nomi aggiungere alle liste in `src/lib/availability/bsd.ts`;
5. **le formazioni**: `/v1/stored_matches/<id>/lineups` esiste, ma resta da
   vedere se l'id delle partite di `/v1/matches` è lo stesso di
   `stored_matches` e se il piano gratuito la copre;
6. **il vocabolario degli stati**: se arrivano testi di stato veri (il primo
   payload non ne aveva), vanno confrontati con la tabella qui sopra, altrimenti
   finiscono in `unavailable` o in `injured`;
7. **la paginazione**: se le righe sono più di una pagina serve `?limit=`
   (oggi si legge solo la prima);
8. **la quota**: quale header dichiara le richieste residue e che non si
   avvicini a zero (in quel caso allungare l'intervallo del job).

## Da verificare in produzione (API-Football)

Da usare solo se si passa a un piano a pagamento: il piano gratuito risponde
"Free plans do not have access to this season". In quel caso valgono i controlli
di sempre: `errors` vuoto, stagione coperta, nomi dei club previsti, `/injuries`
non vuoto, `x-ratelimit-requests-remaining` che scende come previsto.
