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
