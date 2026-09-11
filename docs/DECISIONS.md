# DECISIONS — registro delle decisioni

Formato: data · decisione · motivo. Le decisioni che cambiano `docs/SPEC.md`
richiedono l'ok dell'admin; le altre si annotano e si va avanti.

- 2026-09-09 · **Proprietà giocatori non esclusiva** (stesso calciatore in più
  squadre); svincolato = posseduto da nessuno; foto svincolati all'apertura della
  sessione. · Regolamento SuperLega + conferma admin; l'export rose reale lo
  dimostra. Sostituisce l'ipotesi di esclusività del brief.
- 2026-09-09 · **Prezzi sempre a Qt.A dell'ultimo listone importato** (acquisto e
  rientro vendita); cambio gratuito fuori lista: rimborso = prezzo pagato. ·
  Conferma admin.
- 2026-09-09 · **Niente scambi tra squadre, mai** (vietati dal regolamento);
  proposta "offerte sigillate" ritirata (senza esclusività non esistono conflitti).
- 2026-09-09 · **Operazione di mercato = cambio (out+in stesso ruolo)**, non
  compravendite separate: la rosa resta sempre 23 a regime e rispecchia il flusso
  del regolamento. Correzioni libere solo via funzioni admin. · Semplifica
  validazione e UX; derogabile in futuro via `league_settings`.
- 2026-09-09 · **Stack confermato dal brief §6** (Next.js + Supabase + Vercel):
  nessuna alternativa proposta — il vincolo 0 €, PWA e RLS sono serviti bene così.
- 2026-09-09 · **Cron**: Vercel Cron 1×/giorno (limite Hobby) per sync quotazioni
  - keep-alive Supabase; orario gestito in codice per il DST Europe/Rome.
- 2026-09-09 · **Audit log attivo in v1** (login, operazioni, azioni admin). ·
  Conferma admin.
- 2026-09-09 · **Hook pre-commit**: lint + typecheck (veloci) prima di ogni
  commit; la suite completa gira in CI. · Commit frequenti non devono costare
  minuti.
- 2026-09-09 · **Fixture reali nel repo** (`fixtures/`): quotazioni 2026/27 ed
  export rose per test del parser. Contengono solo dati pubblici (nomi
  giocatori/squadre della lega).
- 2026-09-09 · **Tool asta esistente spostato in `legacy/`**, non toccato. ·
  Conferma admin.
- 2026-09-09 · **Next.js 16** (App Router, Turbopack): `src/proxy.ts` sostituisce
  il vecchio middleware; API di richiesta tutte async. · Versione corrente di
  `create-next-app`; letta la guida di migrazione inclusa nel pacchetto.
- 2026-09-09 · **Componenti UI scritti a mano in stile shadcn** (cva + tailwind-
  merge) invece della CLI shadcn. · Il registry ui.shadcn.com è bloccato
  dall'ambiente di sviluppo; il risultato è equivalente e sotto controllo.
- 2026-09-09 · **Service worker app-shell scritto a mano** (`public/sw.js`) al
  posto di Serwist/next-pwa. · Con Turbopack di default Serwist richiede uno
  step di build separato; la v1 non prevede offline per il mercato, quindi un SW
  di 60 righe (cache statici, fallback `/offline`) basta ed è più trasparente.
- 2026-09-09 · **Codice lega verificato via RPC `validate_league_code`** (security
  definer, ritorna solo un booleano); il codice non è mai leggibile dai manager.
  Rate limiting applicativo su login/RPC rimandato a M8 (Supabase Auth ha già
  limiti per IP).
- 2026-09-09 · **Primo admin = email in `league_settings.bootstrap_admin_email`**:
  il trigger di signup assegna `admin` a chi si registra con quell'email. In
  produzione la chiave si inserisce con una SQL una tantum (docs/DEPLOY.md).
- 2026-09-09 · **Test DB su Postgres locale** (apt) con uno stub dello schema
  `auth` di Supabase, perché Docker non è disponibile nell'ambiente di sviluppo;
  la verifica finale su Supabase reale avviene in Fase 3.
- 2026-09-09 · **exceljs al posto di SheetJS (`xlsx`)** per il parsing. · Su npm
  SheetJS è fermo alla 0.18.5 con CVE note (prototype pollution, ReDoS); le
  versioni corrette stanno solo sul CDN di SheetJS, bloccato dall'ambiente.
  exceljs è mantenuto su npm e legge gli stessi file.
- 2026-09-09 · **`database.types.ts` scritto a mano** (righe come `type`, non
  `interface`, altrimenti supabase-js le scarta). · `supabase gen types` richiede
  Docker anche con `--db-url`; da rigenerare e confrontare in Fase 3 col progetto
  collegato.
- 2026-09-09 · **Import quotazioni in due passi con payload in DB**: l'anteprima
  salva le righe già parsate in `imports.payload` (jsonb) e la conferma le applica
  in una sola transazione (`apply_quotations_import`), poi il payload viene
  azzerato. · Niente doppio parsing, nessuna dipendenza da Storage per
  applicare; il file resta comunque archiviato nel bucket `imports` quando
  disponibile.
- 2026-09-09 · **Guardia anti-svuotamento**: un file con meno del 50 % dei
  calciatori attivi (`import_min_rows_ratio`) viene rifiutato dal DB, e
  l'anteprima avvisa se più del 10 % uscirebbe dal listone. · Un upload parziale
  per errore non deve mettere fuori lista mezza Serie A.
- 2026-09-09 · **Codice lega applicato nel trigger di signup** (non più in una
  RPC anonima): viaggia nei metadati della registrazione e senza codice valido
  l'utente non viene creato nemmeno chiamando l'API Auth a mano. · Finding
  "alto" della security review M1/M2.
- 2026-09-09 · **Email di conferma e recupero con link `token_hash`** (template
  in `supabase/templates/`, da incollare nella dashboard in produzione) al posto
  del flusso PKCE `?code=`. · Il PKCE funziona solo nello stesso browser che ha
  avviato la registrazione: su iPhone (link aperto da Gmail o dalla PWA) fallisce.
- 2026-09-09 · **Import rose in due tempi con "congelamento"**: l'anteprima
  salva il file parsato; alla conferma le risoluzioni manuali dell'admin (omonimi,
  nomi non trovati → Id) producono un nuovo record import con il payload
  definitivo, che viene applicato atomicamente; l'anteprima viene chiusa. ·
  Tracciabilità completa di cosa è stato applicato e con quali scelte.
- 2026-09-09 · **Import rose = sostituzione**: per ogni squadra nel file la rosa
  corrente viene chiusa (storico conservato) e ricreata, crediti = 250 − speso,
  `swaps_used` azzerato, manager collegato conservato. Squadre assenti dal file
  non vengono toccate. · È l'operazione di inizio stagione; le correzioni
  puntuali passano dalle funzioni `admin_*`.
- 2026-09-09 · **Letture complete paginate** (`fetchAll`, pagine da 1000) per
  listone e rose: PostgREST tronca a 1000 righe e i calciatori non si cancellano
  mai. · Finding QA.
- 2026-09-09 · **Sessione "aperta" = stato `open` E `now() < closes_at`**: allo
  scadere dell'orario i cambi si bloccano da soli anche se l'admin non ha ancora
  premuto "chiudi" (non c'è un cron che chiuda: Vercel Hobby ne consente uno al
  giorno); la chiusura manuale produce il report e fissa `closes_at`. Una sola
  sessione aperta alla volta (indice unico). · Regolamento: scadenza giovedì 20:00.
- 2026-09-09 · **Apertura sessione = foto svincolati + budget extra in un'unica
  transazione con lock su tutte le squadre**; `extra_budget_applied` impedisce il
  doppio accredito; l'accredito è una riga `admin_credits` per squadra nel
  registro. · Tracciabilità e idempotenza (caso #14 della tabella test).
- 2026-09-09 · **Annullamento = operazione inversa** che ripristina il giocatore
  uscito all'ultimo prezzo pagato, toglie quello entrato, inverte i crediti e
  decrementa `swaps_used` se il cambio contava; motivazione obbligatoria; un
  annullamento non si annulla e ogni operazione si annulla al massimo una volta.
  Se nel frattempo il giocatore entrato è stato rivenduto, l'annullamento è
  rifiutato finché non si annullano le operazioni successive. · SPEC §3.
- 2026-09-09 · **Test di concorrenza con connessioni Postgres reali** (`pg`,
  Vitest, `DATABASE_URL`): 3 cambi paralleli sulla stessa squadra → uno solo passa;
  2 squadre che prendono lo stesso svincolato in parallelo → entrambe passano.
  · Definition of done (proprietà non esclusiva, integrità crediti/limiti).
- 2026-09-09 · **Orari delle sessioni inseriti in ora italiana** (`datetime-local`)
  e convertiti in UTC lato server con `Intl` (gestione DST senza librerie).
- 2026-09-09 · **Sync quotazioni: cron Vercel alle 04:30 UTC** (06:30 CEST /
  05:30 CET) — con una sola esecuzione al giorno (Hobby) l'orario non può
  seguire il DST; `sync_hour` resta in `league_settings` come documentazione.
  La stessa chiamata fa da keep-alive per Supabase Free. · docs/SYNC.md.
- 2026-09-09 · **Sorgente quotazioni pluggable, di default "nessuna"**: la
  sorgente HTTP si attiva solo con `QUOTATIONS_SOURCE_URL` dopo la verifica di
  URL, robots.txt e termini d'uso di Fantacalcio.it (impossibile da questo
  ambiente: dominio bloccato). Regole di cortesia fisse nel codice: 1 richiesta
  al giorno, user-agent identificato, un solo ritentativo, 5 MB max, rifiuto
  delle risposte non-xlsx. L'upload manuale resta il percorso garantito. · Brief §3.6.
- 2026-09-09 · **Il sync usa lo stesso parser e le stesse funzioni DB
  dell'upload manuale** (`create_quotations_import` con `source='auto'` +
  `apply_quotations_import`), quindi anteprima, guardie e storico sono identici;
  "Esegui ora" nell'admin usa lo stesso orchestratore con la sessione dell'admin.
- 2026-09-09 · **Grafico dello storico quotazioni in SVG server-side** (nessuna
  libreria): 10–40 punti per stagione non giustificano una dipendenza. · Lighthouse.
- 2026-09-09 · **Rate limiting senza servizi esterni, a due livelli**: (1) nel DB,
  `check_market_throttle` rifiuta più di `market_ops_per_minute` (5) cambi
  committati per squadra al minuto — non aggirabile via API; (2)
  `consume_rate_limit(bucket, max, finestra)` (tabella `private.rate_limits`,
  finestra fissa per utente) chiamata dalle server action: 10 tentativi/min per
  il mercato, 5 import/10 min. Login e registrazione restano sui limiti di
  Supabase Auth. · Security review M3/M4; vincolo 0 € (niente Upstash/WAF).
- 2026-09-09 · **Lock di sessione e di giocatore nei cambi**: `swap_player`
  prende un lock condiviso sulla sessione aperta (la chiusura, che la blocca in
  scrittura, aspetta i cambi in corso e i cambi successivi vedono lo stato
  nuovo); `free_swap_player` blocca la riga del giocatore entrante, così due
  cambi gratuiti paralleli sullo stesso svincolato non passano entrambi
  (testato). Un fuori lista non si vende con un cambio normale (`USE_FREE_SWAP`).
- 2026-09-09 · **Seed del listone generato dalla fixture reale**
  (`scripts/generate-players-seed.mjs` → `supabase/seed/players.sql`), solo per
  sviluppo locale. · Dati realistici senza scrivere 600 righe a mano.
- 2026-09-09 · **Limiti di rate definiti nel database, non dal chiamante**:
  `consume_rate_limit(bucket)` conosce i bucket (`market` 10/min, `import`
  10/10 min, `export` 10/10 min, `email` 5/ora, `admin` 60/min) e rifiuta quelli
  sconosciuti; prima un manager poteva passare i propri limiti via RPC diretta.
  · Finding QA M3/M4.
- 2026-09-09 · **Niente modifiche admin alle rose a sessione aperta**
  (`admin_assign_player`, `admin_remove_player`, `apply_rosters_import` →
  `SESSION_OPEN`): bypasserebbero la foto svincolati e il registro; durante la
  sessione si corregge solo con gli annullamenti. · Finding QA M3/M4.
- 2026-09-09 · **`admin_set_setting` valida per chiave** (interi, composizione
  {P,D,C,A}, regole ammesse, codice lega 4–64 normalizzato in maiuscolo, chiavi
  sconosciute rifiutate); `teams.short_name` unico; le date `datetime-local`
  impossibili (30 febbraio, ore 24) vengono rifiutate invece di scivolare al
  giorno dopo. · Finding QA M3/M4.
- 2026-09-09 · **Email degli utenti copiate in `profiles.email`** dal trigger di
  signup e lette solo dagli admin tramite grant di colonna + funzioni
  `admin_list_users` / `admin_notification_recipients`; i manager vedono
  l'elenco nomi senza indirizzi. · Serve per il pannello utenti e le email di
  lega senza esporre `auth.users`.
- 2026-09-09 · **Email via API Resend con `fetch`** (niente SDK), endpoint batch
  con un destinatario per messaggio (nessuno vede gli altri indirizzi), mittente
  da `EMAIL_FROM`; esito in `notifications` (inviata/saltata/fallita) visibile in
  Admin → Impostazioni. Un errore di invio **non annulla mai** l'apertura o la
  chiusura della sessione (già committata). Senza `RESEND_API_KEY` le email
  vengono saltate e registrate. · Brief §3.8, vincolo 0 €.
- 2026-09-09 · **Export Excel come route handler** (`/api/admin/export/{rose,
listone,operazioni}`) con exceljs, letture paginate (`fetchAll`) sotto la
  sessione RLS dell'admin, bucket di rate limit `export`; il listone esportato
  usa le stesse intestazioni del file ufficiale (rientra nel parser). · Brief
  §3.7 e backup.
- 2026-09-09 · **Anteprima rose: due righe risolte sullo stesso calciatore** →
  stato `duplicate` (bloccante) invece di un errore 23505 alla conferma.
  · Finding QA M3/M4.
- 2026-09-09 · **Email di sessione inviate con `after()` di Next e timeout di 10 s
  sulla chiamata a Resend**: l'apertura/chiusura risponde subito e l'invio
  avviene dopo la risposta, così un provider lento non blocca né fa sembrare
  fallita un'operazione già committata; esiti parziali registrati come
  `partial`. Codice lega validato dopo la normalizzazione (solo `A-Z0-9-`);
  `bootstrap_admin_email` modificabile solo finché non esiste un admin.
  · Security review M6.
- 2026-09-09 · **Tema per dispositivo in `localStorage` con script inline**
  (niente cookie): il root layout resta statico e non c'è flash; il meta
  `theme-color` è creato e aggiornato solo dallo script, perché quello generato
  da Next veniva inserito dopo e restava scuro. · M7.
- 2026-09-09 · **Icone PWA generate con Chromium** (`scripts/make-icons.mjs`)
  dallo stesso SVG del logo: nessuna dipendenza grafica aggiuntiva, riproducibile.
- 2026-09-09 · **Modifiche admin ammesse a sessione aperta**: crediti squadra,
  creazione squadra e annullamento di operazioni admin restano possibili
  (coerenti col registro); bloccati solo assegnazioni/rimozioni/import rose.
  · Nota QA M6, scelta consapevole.
- 2026-09-09 · **Pulsanti `sm` alti 44 px**: la variante piccola riduce solo
  padding e testo, non l'area di tocco. · Regola design system, nota QA M6.
- 2026-09-09 · **Rate limiting anonimo su login/registrazione/recupero** nel DB
  (`consume_anonymous_attempt`, chiave = hash di indirizzo+email, 10/15 min per
  il login, 5/ora per registrazione e recupero) in aggiunta ai limiti di
  Supabase Auth; se il limitatore fallisce l'accesso non viene bloccato. · M8,
  brief §4 (rate limiting su login), 0 €.
- 2026-09-09 · **Backup = `pg_dump` via `scripts/backup.sh` + export Excel**:
  Supabase Free non ha backup automatici; procedura settimanale documentata in
  docs/DEPLOY.md. · M8.
- 2026-09-09 · **Tema chiaro con palette scurita** (primary `#0369A1`, danger
  `#B91C1C`, colori ruolo dedicati al chiaro) per garantire AA anche sui badge
  a 12 px; test automatico `tests/unit/theme-contrast.test.ts` legge i token da
  `globals.css`. Skip link con destinazione su tutte le pagine; id univoci
  (`useId`) nei pannelli cambio; barra di conferma sopra la bottom-nav anche con
  safe-area iOS. · Review QA M7 (block → risolto).
- 2026-09-09 · **Revoca a `anon` dell'EXECUTE su tutte le funzioni pubbliche**
  (migrazione `20260909180000`), tranne `consume_anonymous_attempt`, anche per
  le funzioni future (default privileges). Su Supabase `anon` riceve EXECUTE
  direttamente e `revoke … from public` non lo toglie: le funzioni di import
  (che ammettono `auth.uid()` nullo per il cron) erano chiamabili senza login.
  Lo stub di test locale ora emula i default privileges di Supabase così il
  test SQL fallisce se la revoca sparisce. · Security review finale (critico).
- 2026-09-09 · **Limitatore anonimo con pulizia deterministica** delle finestre
  scadute a ogni chiamata e tetto di 5.000 chiavi vive per bucket; download
  quotazioni letto a flusso con stop oltre 5 MB; indirizzo client da header
  Vercel; `backups/` e `*.sql.gz` ignorati da git. · Security review finale.
- 2026-09-09 · **CSP rinviata al backlog**: Next inietta script inline di
  idratazione che richiedono un nonce per richiesta (proxy + `headers()`);
  gli altri header di sicurezza sono attivi in `next.config.ts`.
- 2026-09-10 · **Import rose: nomi assenti dal listone importabili come "fuori
  lista" (segnaposto)**. Chi ha lasciato la Serie A dopo l'asta non compare più
  in nessun foglio del listone, ma per regolamento resta in rosa finché il
  manager non lo svincola gratis con rimborso del prezzo pagato. L'anteprima
  offre per ogni "non trovato" la scelta Id Fantacalcio **oppure** fuori lista
  (ruolo scelto o dedotto dal buco nella composizione 3/7/7/6; `*` nel file =
  fuori lista di default; casella "segna tutti"). Il DB crea `players` con Id
  **negativo**, squadra "Fuori Serie A", Qt.A 0, `out_of_list`; gli import del
  listone (upsert per Id) non li toccano e non sono mai svincolati. Alternativa
  scartata: saltare la riga (rosa a 22 e crediti sbagliati) o assegnare un Id
  fittizio positivo (collisione con Fantacalcio.it). · Fase 3, primo import
  reale (11 nomi non trovati). Migrazione `20260909190000`.
- 2026-09-10 · **Skill `ui-ux-pro-max` installata nel repo** (copia di
  `data/` + `scripts/` e SKILL.md reso dal template Claude, come farebbe
  `uipro init --ai claude`; script Python solo locali, nessuna rete). Serve da
  base per il secondo design pass (motion, micro-interazioni, eventuale 3D);
  i token di docs/DESIGN.md restano vincolanti. Richiesta dell'admin.
- 2026-09-10 · **Sessioni: apertura e chiusura automatiche** all'orario
  programmato, senza pg_cron né job esterni: `sync_market_sessions()` viene
  chiamata dal layout dell'app a ogni pagina autenticata e dal cron notturno;
  la transizione avviene alla prima richiesta dopo l'orario (idempotente,
  lock `skip locked`). "Apri ora"/"Chiudi sessione" restano per anticipare.
  Le email delle transizioni automatiche partono con il service role: le
  funzioni `admin_notification_recipients`, `log_notification` e
  `consume_rate_limit` riconoscono il service role dalla claim JWT
  (`private.is_service_role()`, null-safe). Motivo: nel primo test l'admin si
  aspettava l'apertura all'orario e la sessione era rimasta "programmata".
  Migrazione `20260909200000`.
- 2026-09-10 · **Id negativi ammessi nelle azioni di mercato e admin** (Zod
  `!= 0` invece di `positive()`): il cambio gratuito di un segnaposto fuori
  lista veniva rifiutato in silenzio. Il pannello cambio mostra anche l'errore
  sul calciatore in uscita.
- 2026-09-10 · **Mercato v2: svincolo e acquisto separati** (richiesta
  dell'admin dopo il primo test, cambia SPEC §3): `sell_player` (sessione
  aperta, rientro Qt.A), `buy_player` (solo ruoli con posti liberi, conta un
  cambio), `release_out_of_list` + acquisto "gratuito" in qualsiasi momento
  per i fuori lista, con gli slot gratuiti derivati dal registro non annullato
  (nessuno stato aggiuntivo). Il vincolo di ruolo è per conteggio (2D+1C fuori
  → 2D+1C dentro), non per abbinamento. I posti vuoti alla chiusura restano
  nel report: non si blocca la chiusura né lo svincolo a fine sessione (scelta
  mia, reversibile). `swap_player`/`free_swap_player` restano nel DB per lo
  storico e i test, la UI non le usa più. `reverse_transaction` invariata:
  funziona per campo (in/out/crediti/contatore). Migrazione `20260909210000`.

- 2026-09-10 · **Rose, crediti e operazioni privati per squadra** (richiesta
  dell'admin, cambia SPEC §2): policy RLS "propria squadra o admin" su `teams`,
  `roster_players`, `transactions`; `league_teams()` (security definer) per
  l'elenco pubblico nome/sigla/colori/manager; la vista `free_agents` passa a
  `security_invoker = false` con filtro `is_league_member()` così la lista
  svincolati resta corretta senza esporre le rose; `team_market_state` solo per
  chi gestisce la squadra. Alternativa scartata: nascondere solo in UI.
  Migrazione `20260909220000`.
- 2026-09-10 · **Security review mercato v2** (bloccante risolto): il
  limitatore DB `check_market_throttle` conta anche `sell/buy/free_release`
  (prima contava solo i cambi: 0 per le nuove funzioni, aggirabile via API
  diretta). Le transizioni automatiche delle sessioni sono attribuite al
  sistema (`user_id`/`created_by` null, `source: auto`, via `private.audit_as`)
  e non al manager che ha caricato la pagina; ricontrollo "una sola sessione
  aperta" dopo il lock delle squadre; email di chiusura conta le operazioni v2;
  scelte "fuori lista" dell'import validate riga per riga. Migrazione
  `20260909250000` (rinumerata: la revisione l'aveva creata come 230000, in
  conflitto con `player_status`).
- 2026-09-11 · **Stato di disponibilità dei calciatori con fonte** (richiesta
  dell'admin: "infortunato, con la notizia e la fonte"): tabella
  `player_status` scritta a mano dall'admin da _Admin → Indisponibili_, letta
  da tutti, mostrata nella rosa con link alla fonte e data. Fonte automatica
  rinviata: Fantacalcio.it (pagina indisponibili) richiede la verifica di
  robots/termini d'uso dal computer dell'admin (la rete di sviluppo blocca il
  dominio); API-Football ha un piano gratuito con endpoint `injuries` ma
  richiede un account e va verificata la copertura della stagione corrente.
  Entrambe passeranno da `private.set_player_status` come sorgente pluggable.
  Migrazione `20260909230000`.
- 2026-09-11 · **Avatar v1 rivisti su feedback dell'admin**: mezzo busto senza
  pallone, più dettaglio; mostrati solo nella rosa del manager (dove si fanno
  svincoli e acquisti), non nel listone. In corso.
- 2026-09-11 · **`where true` obbligatorio negli UPDATE su tutte le righe**:
  Supabase esegue i ruoli API con `pg-safeupdate`, che rifiuta gli UPDATE senza
  WHERE ("UPDATE requires a WHERE clause"); l'accredito del budget extra
  all'apertura non lo aveva e "Apri ora"/apertura automatica fallivano solo in
  produzione. Regola annotata nella skill supabase-conventions. Migrazione
  `20260909240000`.
- 2026-09-11 · **Avatar v2 a mezzo busto e riga rosa con stato**: ritratto
  testa-spalle-maglia senza pallone, tratti aggiuntivi (sopracciglia, lunghezza
  capelli, tono pelle), 55 giocatori curati; componente `RosterPlayerRow`
  (avatar, nome, ruolo, club, pagato, delta vs Qt.A, Qt.A grande, chip di
  stato con fonte e data, slot azioni) e `RosterPlayerList` per ruolo con i
  posti da riempire. Anteprima admin `/admin/anteprima-rosa`; integrazione in
  Rosa/Mercato dopo l'ok dell'admin. Gli avatar non compaiono nel listone
  (scelta dell'admin).
- 2026-09-11 · **Export rose anche nel layout Leghe Fantacalcio** (richiesta
  dell'admin "excel delle rose aggiornate dopo la sessione"): terzo foglio
  "ROSE" a blocchi di 3 colonne, ordinato per ruolo e Qt.A, `*` sui fuori
  lista, riga Totale, 5 squadre per banda; test di andata e ritorno con il
  parser dell'import. Pulsante di download nella pagina della sessione chiusa.
  Il foglio dettagliato si chiama ora "Dettaglio" (ExcelJS non distingue
  "Rose"/"ROSE").
- 2026-09-11 · **Avatar con profondità e riga rosa attiva in Rosa e Mercato**
  (ok dell'admin sullo stile, richiesta "leggermente 3D"): volume solo con
  gradienti e ombre SVG (nessun `filter`, nessuna libreria), vignetta e ombra a
  terra nella cornice, inclinazione di 3° al passaggio/focus solo con motion
  consentita e puntatore hover. `RosterPlayerList` sostituisce la tabella nella
  Rosa del manager; il pannello di svincolo del Mercato usa `RosterPlayerRow`
  con lo stato (Indisponibili) e il pulsante nello slot azioni; avatar 32 px
  nelle tessere di acquisto. `RosterTable` resta nelle pagine admin e squadra.
- 2026-09-11 · **Operazioni di sessione in sospeso fino alla chiusura**
  (richiesta dell'admin: "il conteggio dei cambi solo dopo la conferma, uno si
  può pentire; si registrano ufficialmente quando il mercato si conclude"):
  `transactions.status pending|confirmed`; svincoli e acquisti in sessione
  nascono pending, muovono subito rosa e crediti, il manager li annulla con
  `undo_pending_operation` (la riga sparisce, audit `market.undo`); la
  chiusura li conferma tutti e conta gli acquisti; il limite dei 20 vale
  sommando confermati e in sospeso; l'admin annulla solo righe confermate. Il
  trigger di immutabilità ammette le sole transizioni pending→confirmed e
  DELETE di righe pending. Nessun pulsante "Conferma" in UI (l'admin ha
  chiesto la registrazione alla chiusura); la funzione resta nel DB. Elenco
  acquisti: tutti gli svincolati della sessione, con motivo di blocco per
  ruolo sulle tessere non acquistabili (prima erano nascosti e sembravano
  mancanti). Migrazione `20260909260000`.
- 2026-09-11 · **Feed automatico indisponibili e titolarità da API-Football**
  (piano gratuito, 0 €): nuovo `player_status.origin manual|feed` con la regola
  **il manuale batte il feed** (una riga scritta dall'admin non viene mai
  sovrascritta né cancellata), nuove tabelle `player_lineup_status` (chip
  Titolare/In panchina entro 12 ore dal calcio d'inizio) e
  `external_player_map` (l'abbinamento nome API ↔ listone si indovina una volta
  sola e l'admin lo corregge). Scrittura solo dal service role
  (`sync_availability`); l'abbinamento ambiguo **non si applica** e finisce
  nell'elenco "Nomi da abbinare" — meglio uno stato mancante che uno sbagliato.
  Budget rigido di **3 richieste per esecuzione** (indisponibili + calendario +
  formazioni solo se una partita inizia entro 3 ore) sulle 100 al giorno del
  piano gratuito. Cadenza ogni 15 minuti con **pg_cron + pg_net su Supabase**
  (Vercel Hobby dà un solo cron al giorno, già speso per le quotazioni):
  l'admin esegue una volta `supabase/deploy/updates/2026-09-11-availability-cron.sql`;
  rete di sicurezza sulle visite alle pagine con una prenotazione atomica in
  `league_settings`. `api-sports.io` non è raggiungibile dall'ambiente di
  sviluppo: parsing tollerante, errori del fornitore riportati alla lettera nel
  pannello admin, fixture scritte a mano per i test e checklist di verifica in
  produzione in docs/SYNC.md. Migrazione `20260909270000`.
- 2026-09-11 · **Token del programmatore generato dal database**: su Vercel
  `CRON_SECRET` è salvato come valore protetto e non è più leggibile, quindi
  non si poteva incollare nella pianificazione pg_cron. Il DB genera e
  conserva `league_settings.cron_token` (solo admin lo legge, via
  `admin_cron_token`, rigenerabile con `admin_rotate_cron_token`); la rotta
  `/api/cron/sync-availability` accetta `CRON_SECRET` **oppure** quel token,
  verificato con `verify_cron_token` (solo service role). La pagina Admin →
  Indisponibili mostra il comando SQL completo con il token, da copiare.
  Migrazione `20260909280000`.
- 2026-09-11 · **Big Balls Sports Data come fornitore predefinito del feed
  indisponibili, API-Football come alternativa**: il piano gratuito di
  API-Football risponde _"Free plans do not have access to this season, try from
  2022 to 2024"_ per la Serie A 2026/27, quindi a costo zero non copre la
  stagione in corso. Scelta dell'admin: passare a **bigballsdata.com** (piano
  gratuito, senza carta, ~1000 richieste al giorno). Il fornitore resta
  **intercambiabile**: stessa interfaccia `AvailabilityProvider`, scelta con
  `AVAILABILITY_PROVIDER` (`bsd` predefinito quando c'è `BSD_API_KEY`, altrimenti
  `api-football` quando c'è `API_FOOTBALL_KEY`, altrimenti feed spento);
  API-Football resta nel codice perché funziona a pagamento e sulle stagioni
  passate. Dall'ambiente di sviluppo **non si raggiunge né bigballsdata.com né
  api-sports.io**, quindi né i percorsi né la forma del payload sono verificati:
  per chiudere la configurazione in un solo giro con l'admin il provider BSD
  prova una **lista di candidati** per ogni capacità (si ferma al primo `200`
  JSON e memorizza il vincente in `league_settings.availability_endpoints`),
  legge i campi da una lista di nomi plausibili saltando — e contando — le righe
  illeggibili, e salva le **risposte grezze** (primi 1500 caratteri per chiamata,
  max 4 KB, chiave sempre rimossa) in `league_settings.availability_last_samples`,
  che l'admin apre in Admin → Indisponibili → "Mostra risposta grezza"
  (spunta "Modalità diagnostica" per salvarle anche quando l'aggiornamento
  riesce). Budget 12 richieste per esecuzione con BSD (2-3 a regime), 3 con
  API-Football. Migrazione `20260909290000`; ipotesi da verificare in produzione
  elencate in docs/SYNC.md.
- 2026-09-11 · **Il feed BSD si configura da solo leggendo le rotte del
  fornitore**: alla prima esecuzione vera la chiave funziona (93 richieste
  residue dichiarate) ma **tutti i percorsi indovinati rispondono 404**, con un
  corpo che dice dove guardare: _"Browse every endpoint at GET /v1/ or the
  OpenAPI spec at GET /openapi.json"_. Invece di continuare a tirare a indovinare
  (e di aspettare un altro giro di messaggi con l'admin), il provider legge quel
  documento — OpenAPI o semplice elenco, in qualunque forma —, sceglie la rotta
  di ogni capacità **per parole chiave** (`injur`, `fixture`/`match`/`schedule`,
  `lineup`/`formation`…) e prende i **nomi dei parametri dal documento stesso**
  (`league_id` invece di `league`, la stagione solo se dichiarata, il segnaposto
  `{fixtureId}` riempito); se l'enum delle leghe non contiene il valore
  configurato usa la voce che somiglia a "serie a" e lo scrive nel pannello.
  Tutto viene messo in cache in `league_settings.availability_endpoints`
  (chiave `routes`, retrocompatibile con i candidati già salvati): la scoperta
  costa una richiesta la prima volta e zero dopo, e riparte da sola se una rotta
  memorizzata comincia a rispondere 404. Budget per esecuzione 12 → **16**.
  I candidati statici restano come rete di sicurezza se non c'è nessun elenco da
  leggere. Il pannello admin mostra la riga "Rotte del fornitore" (quante
  trovate, quali scelte, quali parole cercate invano) e le risposte grezze della
  scoperta. Nessuna migrazione nuova: cambia solo il contenuto della chiave già
  esistente.
- 2026-09-11 · **Rotte BSD vere, parametro `sport` e correzione automatica delle
  chiamate**: l'elenco del fornitore (125 rotte da `/openapi.json`) dice che gli
  indisponibili stanno in `/v1/injuries`, il calendario in `/v1/matches` e le
  formazioni in `/v1/stored_matches/{id}/lineups` (non esiste
  `/v1/matches/{id}/lineups`): sono ora i primi candidati statici, così un
  ambiente nuovo funziona senza scoperta. `/v1/injuries` risponde `400`
  _"sport or league query param is required"_, quindi ogni chiamata sa
  correggersi da sola una volta per tipo — legge dal messaggio i parametri
  obbligatori e li riempie, chiede a `/v1/leagues?sport=…` come si chiama la
  Serie A quando la nostra lega è rifiutata, e prova `football` se `soccer` non
  va (`BSD_SPORT`, default `soccer`) — memorizzando ogni volta quello che ha
  funzionato. `/v1/matches` ha risposto 200 con 50 righe che il parser non
  sapeva leggere: la lettura delle righe è ora insensibile a maiuscole,
  underscore e trattini, accetta percorsi puntati e indici, epoch in secondi o
  millisecondi, squadre come stringa o oggetto, e quando arrivano righe ma
  nessuna è leggibile il pannello elenca **le chiavi della prima riga** — così
  i nomi veri dei campi si scoprono in un giro solo. Budget per esecuzione
  16 → **24**. Nessuna migrazione nuova.
- 2026-09-11 · **Abbinamento per cognome e abbinamenti "da confermare"**: BSD
  scrive i nomi abbreviati ("L. Balerdi") e dà il club come id opaco
  (`current_team_id: "bb_team_…"`), tradotto con una mappa da `/v1/teams`
  memorizzata insieme a lega e sport. Quando il club non è verificabile, o
  quando il nome combacia solo per cognome (tolta l'iniziale puntata), il
  calciatore **viene comunque segnato** — perdere la notizia sarebbe peggio — ma
  l'abbinamento **non viene memorizzato**: finisce fra i "Nomi da abbinare" come
  _da confermare_, con il candidato già proposto, e basta un clic dell'admin per
  renderlo definitivo. Il cognome vale solo se è **unico** dentro il club (o in
  tutta la lega quando il club è ignoto), altrimenti resta ambiguo. Gli id
  opachi dei calciatori sono ridotti a un intero stabile (FNV-1a a 31 bit)
  perché `external_player_map.external_id` è un intero.
- 2026-09-11 · **Correzioni della revisione di sicurezza del feed e del mercato
  v2.1** (migrazione `20260909300000`): annullare uno svincolo il cui posto è
  già stato riempito ora è rifiutato (`NO_ROLE_SLOT`: prima la rosa poteva
  restare a 24); `undo`/`confirm` richiedono la sessione aperta e passano dal
  limitatore di operazioni; `claim_availability_refresh` revocata ad
  `authenticated` (la chiamava già il service role); `set_player_status`
  rifiuta le fonti non `http(s)` anche a livello DB e lo Zod dell'admin non
  accetta più `javascript:`/`data:`; le espressioni regolari che leggono i
  messaggi d'errore del fornitore hanno quantificatori limitati e leggono solo
  i primi 2000 caratteri (ReDoS misurata: 200 KB = 19,8 s di CPU bloccata);
  `clear_missing` solo quando qualche riga è stata davvero letta, così una
  risposta illeggibile non cancella gli stati; testi d'errore del fornitore
  ripuliti dalle chiavi prima di finire nel database; "Aggiorna adesso"
  limitato per non bruciare la quota.
- 2026-09-11 · **Passata grafica "broadcast futuristico" (design pass)**:
  righe della rosa compattate del ~38% (98 → 61 px a 375 px) con avatar 40 px
  (nuova taglia `xs` = 32 px per le tile di acquisto), quotazione in una
  "stat capsule" tabulare, stato in un chip breve con fonte e data nel `title`
  (il link alla fonte resta, `rel="noopener noreferrer"`), intestazione di
  ruolo come barra sticky dentro la card. Effetti solo da token: bagliore
  radiale sulle card (`.surface-lit`), bordo conico animato sulla sessione
  aperta (`.edge-live`), micro-glow su badge e pallini, glow sui pulsanti
  primari, grana/scanline a bassissima opacità sullo sfondo. **Motion**:
  entrata a cascata delle liste in CSS (24 ms, max 280 ms) — non in
  Framer Motion, così le righe renderizzate dal server non restano invisibili
  se il JS tarda; Framer resta per `layout` (riga che cambia gruppo dopo un
  cambio), transizione di pagina, contatori, check disegnato e sottolineatura
  della tab attiva. Tutto dentro `prefers-reduced-motion: no-preference`.
  Mercato riorganizzato come console: rosa a sinistra, acquisto a destra da
  `lg`, striscia delle operazioni in sospeso fissata sopra le due colonne.
- 2026-09-11 · **Animazione cinematica dopo il login** (`LoginIntro`, 1,45 s):
  cometa su percorso curvo, impatto, onde d'urto e stemma che si disegna, poi
  tendina in diagonale verso l'alto che scopre la pagina già renderizzata.
  Solo SVG + CSS + Framer Motion (un solo `feGaussianBlur`), nessuna nuova
  dipendenza. Si attiva **una volta per accesso**: `signIn` aggiunge
  `?welcome=1` alla destinazione e il componente consuma subito il parametro
  con `history.replaceState` (un refresh non la ripete). Uno script inline
  dipinge lo sfondo prima del primo paint (niente lampo di pagina) e si
  rimuove da solo dopo 2,2 s se il JS non parte. Sempre saltabile (tap, clic,
  tasto), `aria-hidden`, non prende il focus; con `prefers-reduced-motion`
  diventa una dissolvenza ferma di 200 ms. Accento caldo `--ember`
  (`#ffb648` scuro / `#b45309` chiaro) usato **solo** qui, mai per stati.
- 2026-09-11 · **Email agli admin a ogni cambio gratuito + provider Brevo**:
  il giro fuori lista (`release_out_of_list` e l'acquisto `buy_player` che non
  conta nei 20) manda **un'email per operazione ai soli admin**
  ("SuperLega · Cambio gratuito: <squadra>") con squadra, manager, chi
  esce/entra con rimborso o costo, crediti residui, se conta nel limite, ora
  italiana e link al registro. Parte da `after()` dopo la commit, come le email
  di sessione: un problema di posta non annulla mai un'operazione di mercato.
  Gira con il **service client** perché la lista destinatari e
  `log_notification` restano admin-only, mentre il limitatore è contato sul
  manager che l'ha innescata. `admin_notification_recipients(p_admins_only)`
  sostituisce la versione senza argomenti (una sola firma: due overload
  renderebbero ambigua la chiamata PostgREST). Bucket **`email_ops`, 30/ora**,
  separato da `email` (5/ora): una raffica di cambi gratuiti non fa più sparire
  in silenzio gli avvisi di sessione, e quando scatta la notifica è registrata
  come "Saltata" con il motivo. Nuova impostazione `notifications_free_swap`
  (default acceso) nella whitelist di `admin_set_setting`.
  **Provider email**: `sendEmails` non parla più solo Resend. `EMAIL_PROVIDER`
  sceglie (`brevo` | `resend`), altrimenti vince Brevo se c'è `BREVO_API_KEY`,
  poi Resend, poi nessuno (comportamento "Saltata" invariato). Brevo perché
  l'account **esiste già** per l'SMTP di Supabase Auth e il piano gratuito
  (300 email/giorno) copre la lega a 0 €: `POST /v3/smtp/email`, una chiamata
  per destinatario, timeout 10 s, errori del fornitore riportati **testuali**
  nel log notifiche (la chiave non compare mai). `EMAIL_FROM` resta
  `Nome <indirizzo>` e l'indirizzo deve essere un mittente verificato.

- 2026-09-11 — **Il pacchetto di aggiornamento SQL resta rieseguibile.**
  `20260909200000_session_autopilot.sql` concedeva `execute` a `service_role`
  nominando `admin_notification_recipients()` senza argomenti: dopo
  `20260909310000` quella firma non esiste più, quindi la **seconda** incollata
  del file `supabase/deploy/updates/2026-09-10-market-v2.sql` si fermava lì
  (l'installazione da zero non era toccata, l'ordine è giusto). Ora la migrazione
  concede i permessi a **qualunque firma presente** (ciclo su `pg_proc`) e
  ricrea la versione senza argomenti **solo se** l'overload con parametro non
  c'è ancora. Regola generale: una migrazione che finisce nel pacchetto
  cumulativo non deve mai nominare una firma che una migrazione successiva
  sostituisce. Il pacchetto si rigenera con `scripts/build-deploy-update.sh`
  (prima era cucito a mano e poteva divergere dalle migrazioni).

- 2026-09-11 — **L'intro del login dura e lo stemma pulsa.** Su richiesta
  dell'admin ("troppo veloce, è un attimo e sparisce… il logo deve rimanere e
  palpitare"): da 1,45 s a **4,2 s**, con la cometa che _cresce_ venendo verso
  la camera su una griglia in prospettiva, scintille all'impatto e lo stemma
  montato come **pila di 9 facce in `preserve-3d`** — così ha spessore vero e la
  rotazione lo mostra. Dopo l'ingresso non se ne va: batte in loop (scala, lieve
  oscillazione 3D, alone che respira, anello spinto fuori a ogni battito, riflesso
  che attraversa lo scudo) finché la tendina non sale. I tempi stanno tutti in
  `intro-timing.tsx` e un test blocca il contratto (il battito deve iniziare ben
  prima della tendina). Restano invariati: si vede una volta per accesso, un
  tocco la salta, `aria-hidden`, e con `prefers-reduced-motion` è una dissolvenza
  ferma. Alzato anche il budget di caricamento del chunk da 1,2 s a 2,5 s: su
  mobile lento saltarla del tutto era peggio che partire tardi.
  **Higgsfield**: provato per generare un fondale 3D (piano gratuito, 0 €), ma
  l'ambiente di build non può scaricare il CDN che ospita i render, quindi
  l'animazione resta **tutta vettoriale/CSS** — nessun asset raster, niente peso
  aggiunto e i colori seguono il tema chiaro/scuro.

- 2026-09-11 — **Il nome vero è "The SuperLeague".** Su indicazione dell'admin
  cambia tutto ciò che vede l'utente: wordmark (`The Super` + `League`),
  intro, `<title>`, manifest (`short_name` "SuperLeague", ≤ 12 caratteri per
  la home screen), etichette, pagina offline, email (intestazione, oggetti,
  mittente predefinito), creatore dei file Excel. Restano com'erano gli
  identificatori tecnici (package, database, `superlega_test`, i fixture) e
  "SuperLega" nei documenti interni come nome breve: rinominare tutto lì non
  cambia niente per la lega e sporca lo storico delle decisioni.

- 2026-09-11 — **Fondale Higgsfield nell'intro e nel login.** L'admin ha
  chiesto di curare la grafica con Higgsfield. Con i crediti gratuiti del piano
  free (0 €) ho generato un vortice di luce astratto nella nostra palette
  (ciano + brace, niente testi, loghi, persone o palloni: nessun problema di
  licenza, è un'opera generata su nostro prompt) e un video di 4 s dallo stesso
  fotogramma. L'ambiente di build non raggiunge il CDN di Higgsfield: il file è
  passato dalla sandbox di Higgsfield (ridotto a 768 px, WebP, **38 KB**,
  verificato con SHA-256) a `public/intro/backdrop.webp`. Sta **dietro** allo
  stemma vettoriale — l'identità resta la nostra — con una lenta spinta in
  avanti durante l'intro e, sulle pagine di accesso, come sfondo vignettato con
  una deriva di 26 s. **Solo tema scuro**: è un render scuro, nel tema chiaro
  resta il fondo piatto. Il **video** non è nell'app: 4 s a 720p pesano più di
  tutta la pagina di login e su iOS l'autoplay non è garantito; lo si rivede
  nella galleria Higgsfield e si può integrare in seguito se l'admin lo vuole
  davvero (con un peso di ~400 KB a ogni accesso).
