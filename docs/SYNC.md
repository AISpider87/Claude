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

| Capacità      | Candidati provati in ordine                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| indisponibili | `/v1/football/injuries?league=…` · `/football/injuries?league=…` · `/v1/soccer/injuries?league=…` · `/injuries?league=…` |
| calendario    | `/v1/football/fixtures?league=…&status=upcoming` · `/football/fixtures?league=…` · `/v1/soccer/fixtures?league=…`        |
| formazioni    | `/v1/football/lineups?fixture=<id>` · `/football/fixtures/<id>/lineups` · `/v1/soccer/lineups?fixture=<id>`              |

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

### Cache e budget

- Rotta scelta, nomi dei parametri ed eventuale valore di lega sostituito
  finiscono in `league_settings.availability_endpoints`
  (`save_availability_diagnostics`, riservata al service role), sotto la chiave
  `routes`; i vecchi candidati salvati (`{"injuries": "/…"}`) continuano a
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

## BSD: lettura tollerante del payload

Neanche la forma del payload è verificata, quindi il parser accetta molte
varianti e **salta** (contandola) qualunque riga che non riesce a leggere —
meglio uno stato mancante che uno stato sbagliato sulla rosa di qualcuno.

- **Dove sono le righe**: alla radice, oppure sotto `data`, `response`,
  `results`, `items`, `rows`, `records` (anche annidati di un livello).
- **Nome del calciatore**: `player.name` | `player` (stringa) | `name` |
  `playerName` | `athlete.name`.
- **Club**: `team.name` | `team` (stringa) | `club` | `teamName`.
- **Stato**: `status` | `type` | `injuryStatus` | `availability` | `reason` |
  `description`.
- **Rientro previsto**: `expectedReturn` | `returnDate` | `until` (finisce nella
  nota, non nella logica).
- **Formazioni**: una riga per squadra con `startXI`/`starters`/`lineup` e
  `substitutes`/`bench` (le voci possono essere oggetti o nomi nudi), **oppure**
  una riga per calciatore con `isStarter` / `starting` / `startXI` /
  `lineup: "start"`. Una riga senza nessuna delle due cose viene saltata: non si
  dà del titolare a nessuno per esclusione.

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
4. **Un solo candidato nel club giusto** → abbinamento `auto`, salvato per le
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

**Verificato il 2026-09-11**, prima esecuzione vera con la chiave dell'admin:

- l'indirizzo base `https://api.bigballsdata.com` risponde e **la chiave è
  valida** (l'API ha dichiarato 93 richieste residue);
- **nessuno dei candidati statici esiste**: tutti `404 route_not_found`, con il
  corpo che indica `GET /v1/` e `GET /openapi.json` — da qui la scoperta
  automatica delle rotte.

**Resta da verificare al primo aggiornamento con la scoperta attiva** (modalità
diagnostica accesa):

1. che `/openapi.json` (o `/v1/`) risponda davvero e in un formato riconosciuto:
   la riga "Rotte del fornitore" dice quante rotte sono state trovate e quali
   sono state scelte; se dice "formato non riconosciuto", serve il corpo grezzo;
2. che le **parole chiave** peschino la rotta giusta: se una capacità non trova
   niente, il pannello elenca le parole cercate — vanno confrontate con
   l'elenco vero delle rotte;
3. che i **nomi dei parametri** presi dal documento siano quelli giusti e che
   non ne manchi uno obbligatorio (un `400` invece di un `404` è il sintomo);
4. **come si chiama la Serie A**: se il documento dichiara l'enum delle leghe la
   sostituzione è automatica ed è scritta nel pannello, altrimenti va messo il
   valore giusto in `BSD_LEAGUE`;
5. **come si autentica**: mandiamo `Authorization: Bearer` **e** `x-api-key`; se
   il servizio volesse la chiave in query string va cambiato il codice;
6. **i nomi dei campi** di ogni riga (calciatore, club, stato, rientro) e il
   punto in cui stanno le righe nel payload;
7. **il vocabolario degli stati**: le parole vere vanno aggiunte alla tabella
   qui sopra, altrimenti tutto finisce in `unavailable`;
8. **l'id esterno**: se le righe non hanno un id numerico per calciatore
   l'abbinamento manuale non è possibile (il pannello lo dice riga per riga) e
   restano solo i nomi;
9. **le formazioni**: se la rotta non esiste sul piano gratuito, restano gli
   indisponibili e gli stati manuali;
10. **la quota**: quale header dichiara le richieste residue e che non si
    avvicini a zero (in quel caso allungare l'intervallo del job).

## Da verificare in produzione (API-Football)

Da usare solo se si passa a un piano a pagamento: il piano gratuito risponde
"Free plans do not have access to this season". In quel caso valgono i controlli
di sempre: `errors` vuoto, stagione coperta, nomi dei club previsti, `/injuries`
non vuoto, `x-ratelimit-requests-remaining` che scende come previsto.
