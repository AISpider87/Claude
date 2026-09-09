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
- 2026-09-09 · **Seed del listone generato dalla fixture reale**
  (`scripts/generate-players-seed.mjs` → `supabase/seed/players.sql`), solo per
  sviluppo locale. · Dati realistici senza scrivere 600 righe a mano.
