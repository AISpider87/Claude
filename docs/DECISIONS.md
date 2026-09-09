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
  + keep-alive Supabase; orario gestito in codice per il DST Europe/Rome.
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
