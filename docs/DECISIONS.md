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
