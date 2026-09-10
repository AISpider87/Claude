# DATA_MODEL — SuperLega

Tutte le date in UTC (`timestamptz`); crediti e prezzi `integer`. RLS attiva su
ogni tabella; scritture di dominio solo via funzioni `SECURITY DEFINER`.

## Tabelle

### profiles

`user_id uuid PK → auth.users`, `display_name`, `role text check (admin|manager)`,
`is_active bool`, timestamps. Creato da trigger su signup.

### teams

`id`, `name unique`, `short_name (3 lettere)`, `color_primary`, `color_secondary`,
`owner_id uuid null unique → profiles` (assegnato dall'admin quando il manager si
registra), `credits int check (credits >= 0)`, `swaps_used int default 0`,
timestamps. 20 righe.

### players (listone)

`id int PK` (Id Fantacalcio; **negativo** per i "segnaposto" creati dall'import
rose per chi ha lasciato la Serie A: `team = 'Fuori Serie A'`, `status =
out_of_list`, mai toccati dagli import del listone), `name`, `team text` (squadra Serie A),
`role_classic check (P|D|C|A)`, `role_mantra text`, `qt_a, qt_i, diff, qt_a_m,
qt_i_m, diff_m, fvm, fvm_m int`, `status check (active|out_of_list)`,
`out_of_list_at`, `updated_at`.

### imports

`id`, `kind check (quotations|rosters)`, `source check (manual|auto)`,
`file_name`, `file_path` (Storage, bucket `imports`), `status check
(previewed|applied|failed)`, `payload jsonb` (righe parsate, azzerato dopo
l'apply), `stats jsonb` (anteprima + esito: nuovi/aggiornati/invariati/rientrati/
usciti/variazioni rilevanti/anomalie), `error`, `created_by`, `created_at`,
`applied_at`.

### player_quotations (storico, uno snapshot per import applicato)

`import_id → imports`, `player_id → players`, `qt_a, qt_i, fvm ...`, `recorded_at`.
PK (import_id, player_id).

### market_sessions

`id`, `name`, `opens_at`, `closes_at`, `status check (scheduled|open|closed)`,
`extra_budget int default 5`, `opened_at`, `closed_at`, `validation_report jsonb`.

### session_free_agents (foto degli svincolati all'apertura)

`session_id → market_sessions`, `player_id → players`. PK (session_id, player_id).
Popolata da `open_market_session()`: players attivi con nessuna riga viva in
`roster_players`. Un acquisto NON rimuove la riga (acquisti multipli leciti nella
stessa sessione).

### roster_players

`id`, `team_id → teams`, `player_id → players`, `price_paid int`, `acquired_at`,
`acquired_via check (initial_import|admin|swap|free_swap|buy|reversal)`, `released_at null`,
`released_via null check (swap|free_swap|sell|free_release|admin|reversal)`.
Vincolo: unique (team_id, player_id) dove `released_at is null`.
**Nessun vincolo di unicità globale sul player** (proprietà non esclusiva).
Rosa corrente = righe con `released_at is null`; lo storico non si cancella mai.

### transactions (registro immutabile)

`id`, `team_id`, `session_id null` (null per cambio gratuito fuori sessione),
`kind check (sell|buy|free_release|swap|free_swap|admin_assign|admin_remove|admin_credits|reversal)`,
`player_out_id null`, `player_out_price null` (rientro),
`player_in_id null`, `player_in_price null`, `credits_delta int`,
`counts_toward_limit bool`, `note`, `reversal_of null → transactions unique`,
`created_by`, `created_at`. Niente UPDATE/DELETE: nessun grant, nessuna policy e
un trigger `forbid_change` che blocca anche le funzioni security definer.

### free_agents (vista, `security_invoker`)

`players` attivi senza righe vive in `roster_players`. È la definizione di
"svincolato adesso"; la foto per sessione sta in `session_free_agents`.

### league_settings

`key text PK`, `value jsonb`, `updated_by`, `updated_at`. Chiavi: `league_code`,
`initial_budget` (250), `roster_composition` ({P:3,D:7,C:7,A:6}), `season_swap_limit`
(20), `session_extra_budget` (5), `sale_price_rule` ("current_quotation"),
`free_swap_refund_rule` ("price_paid"), `sync_enabled`, `sync_hour`.

### audit_log

`id`, `user_id null`, `action`, `entity`, `entity_id`, `payload jsonb`,
`created_at`. Solo INSERT (da funzioni e server actions); lettura solo admin.

## Funzioni Postgres (SECURITY DEFINER, tutte con lock `teams FOR UPDATE`)

- `admin_create_session / admin_update_session / admin_delete_session` — solo
  admin; `sync_market_sessions()` — chiude le sessioni aperte scadute e apre la
  prima programmata in orario (chiamata a ogni pagina autenticata e dal cron;
  idempotente, `for update skip locked`); `current_market_session()` — la sessione in cui si può operare adesso
  (`open` e `now() < closes_at`); `validate_rosters()` — report per squadra.
- `open_market_session(session_id)` — solo admin: stato→open, fotografa
  `session_free_agents`, accredita `extra_budget` a tutte le squadre (una volta,
  righe `admin_credits`), audit.
- `close_market_session(session_id)` — solo admin: stato→closed, valida ogni rosa
  (23, 3/7/7/6, niente fuori lista, crediti ≥ 0), salva `validation_report`.
- `sell_player(team_id, player)` — manager proprietario (o admin), sessione aperta:
  chiude la riga rosa (`released_via = sell`), crediti += Qt.A attuale
  (`sale_price_rule`), riga `sell` nel registro, non conta nei 20.
- `release_out_of_list(team_id, player)` — in qualsiasi momento, `player.status =
out_of_list`: rimborso = `price_paid` (`free_swap_refund_rule`), riga
  `free_release`, non conta.
- `buy_player(team_id, player)` — riempie un posto libero **dello stesso ruolo**
  (`private.role_slots` = composizione − rosa attuale). Se il ruolo ha uno "slot
  gratuito" (`private.free_slots` = svincoli gratuiti non ancora compensati, dal
  registro non annullato) l'acquisto è consentito in qualsiasi momento tra gli
  svincolati attuali e non conta; altrimenti serve la sessione aperta, il
  giocatore nella foto svincolati e `swaps_used < limite` (conta, `swaps_used += 1`).
  Costo = Qt.A attuale; crediti ≥ 0. `team_market_state(team)` espone posti e slot
  gratuiti per ruolo alla UI.
- `swap_player(team_id, player_out, player_in)` — (storico, non più usato dalla UI) manager proprietario (o admin),
  sessione aperta: `player_in` nella foto svincolati e `active`; stesso ruolo
  classic; rientro = Qt.A attuale di out (`sale_price_rule`), costo = Qt.A attuale
  di in; crediti ≥ 0 dopo; `swaps_used < season_swap_limit`; chiude la riga rosa
  di out, apre quella di in, una riga `swap` nel registro, `swaps_used += 1`.
- `free_swap_player(team_id, player_out, player_in)` — (storico, non più usato dalla UI) anche fuori sessione:
  `player_out.status = out_of_list`; `player_in` svincolato **al momento attuale**
  e attivo, stesso ruolo; rimborso = `price_paid` di out, costo = Qt.A di in;
  non incrementa `swaps_used`, `counts_toward_limit=false`.
- `reverse_transaction(tx_id, reason)` — solo admin: crea la transazione inversa
  (rimette/rimuove le righe rosa, restituisce/detrae crediti, decrementa
  `swaps_used` se contava), collega `reversal_of`.
- `admin_upsert_team(id?, name, short_name?, colors?)`, `admin_set_team_owner(team,
user?)` (un solo team per utente), `admin_set_team_credits(team, credits, note)`
  (riga `admin_credits` nel registro) — gestione squadre.
- `admin_assign_player(team_id, player_id, price)` / `admin_remove_player(team_id,
player_id, refund)` — per la rosa iniziale e le correzioni; scalano/rimborsano
  crediti, righe `admin_assign`/`admin_remove` nel registro, audit sempre.
- `create_rosters_import(...)` / `apply_rosters_import(id)` — sostituzione delle
  rose dal file (vedi DECISIONS); le righe `{placeholder: {name, role}, price_paid}`
  creano/riusano un segnaposto fuori lista (`private.ensure_placeholder_player`,
  sequenza negativa `private.placeholder_player_id_seq`); `team_roster_summary(team)`
  — conteggi per la UI.
- `create_quotations_import(source, file_name, file_path, payload, stats)` —
  salva l'anteprima (righe parsate in `payload`); `apply_quotations_import(id)` —
  upsert per Id, snapshot in `player_quotations`, fuori lista per assenti e
  ceduti, rientro di chi ricompare, statistiche, guardia `import_min_rows_ratio`;
  `fail_import(id, error)` — annulla un'anteprima.
- `admin_set_setting(key, value)` — scrittura di `league_settings` (audit; il
  valore del codice lega non finisce nel log).
- `private.audit(action, entity, entity_id, payload)` — usata da tutte le
  funzioni; `private.setting_int/setting_json` — lettura tipizzata delle
  impostazioni.

Nota v1: niente acquisto/vendita "secchi" — l'operazione di mercato del
regolamento è sempre un cambio (out+in); l'admin può comunque correggere con le
funzioni `admin_*`.

## RLS (sintesi)

| Tabella                                                                                               | SELECT                                                      | Scritture               |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------- |
| profiles                                                                                              | proprio profilo; admin tutti; nome/ruolo visibili alla lega | solo funzioni/trigger   |
| teams, roster_players, transactions, market_sessions, session_free_agents, players, player_quotations | tutti gli utenti autenticati e attivi                       | solo funzioni           |
| imports, league_settings, audit_log                                                                   | solo admin (league_code mai esposto ai manager)             | solo admin via funzioni |

`is_admin()` e `is_league_member()` come funzioni helper `security definer stable`.

## Aggiunte M6 (pannello admin)

- `profiles.email` (copiata da `auth.users` dal trigger di signup e da un trigger
  su cambio email): grant di colonna solo tramite le funzioni admin; il grant
  SELECT di `authenticated` esclude la colonna.
- `notifications` (`kind`, `subject`, `recipients`, `status sent|failed|skipped`,
  `detail`, `created_by`, `created_at`): log delle email di lega, lettura solo
  admin, scrittura via `log_notification()`.
- Funzioni admin di sola lettura: `admin_list_users()`, `admin_notification_
recipients()`, `admin_audit_log(limit)`.
- `consume_rate_limit(bucket)`: bucket e limiti definiti nella funzione
  (`market`, `import`, `export`, `email`, `admin`); tabella `private.rate_limits`.
- `private.assert_no_open_session()`: usata da `admin_assign_player`,
  `admin_remove_player`, `apply_rosters_import` (errore `SESSION_OPEN`).
- `admin_set_setting(key, value)` valida forma e intervallo per ogni chiave nota
  e rifiuta le chiavi sconosciute; nuova chiave `notifications_enabled`.
- Indice unico `teams_short_name_key`.
