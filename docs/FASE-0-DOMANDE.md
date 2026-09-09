# Fase 0 — Domande e decisioni

> Stato: **quasi chiusa** — regolamento, quotazioni ed export rose ricevuti e studiati
> (sintesi in `docs/REGOLE-LEGA.md`). Restano i 4 punti aperti in fondo.

## Decisioni confermate

| Tema | Decisione |
|------|-----------|
| Lega | **SuperLega 2026/27**, 20 squadre, modalità Classic |
| Rosa | **23 = 3P/7D/7C/6A**, budget **250 fanta-milioni** interi, residuo riportato; **+5** a ogni apertura di sessione |
| Rose iniziali | Import dall'export "Rose" di Leghe Fantacalcio (`fixtures/rose_superlega_export.xlsx`); crediti residui = 250 − totale speso |
| Proprietà giocatori | **Non esclusiva**: lo stesso calciatore può stare in più squadre. "Svincolato" = posseduto da nessuno. Nelle sessioni si comprano solo svincolati |
| Conflitti | Non esistono: durante la stessa sessione più squadre possono prendere lo stesso svincolato; dalla sessione successiva non è più disponibile |
| Limiti | **20 cambi a stagione** per squadra (esclusi i "fuori lista", gratuiti), nessun limite per sessione; **scambi tra squadre vietati**; crediti negativi vietati |
| Sessioni | 4 sessioni (dopo giornate 3, 13, 23, 30); finestre gestite dall'admin nell'app |
| Fonte quotazioni | Fantacalcio.it confermata (`fixtures/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx`); aggiornamento automatico 1×/giorno 06:00; foglio "Ceduti" → marcatura automatica fuori lista |
| Iscrizione | Codice lega + verifica email; niente Google login in v1 |
| Hosting | Vercel Hobby + Supabase Free, **0 €/mese** vincolante; account GitHub esistente, Vercel/Supabase da creare in Fase 3 (guidati) |
| Email v1 | Sì: apertura sessione + riepilogo chiusura (Resend) |
| Nome e design | L'app si chiama **SuperLega**; palette su blu chiaro / blu scuro / nero, logo inventato, design "calcio futuristico" da brief §7 |
| Admin | danielgiordan87@hotmail.it (primo admin via seed); altri 2 in seguito, promossi da admin |
| Repo | File esistenti (`index.html`, `avvia.command`, `mac/`) → `legacy/` |
| Sessione di prova | Sì, prima del go-live |
| Fuori scope v1 | Punteggi, formazioni, competizioni (Campionato/Champions/Europa/Conference/Coppa del Riscatto), scambi (vietati da regolamento) → `docs/BACKLOG.md` |

## Punti ancora aperti (default proposti)

1. **Modello svincolati**: confermi l'interpretazione "lista svincolati fotografata
   all'apertura della sessione, acquisti multipli dello stesso svincolato permessi nella
   stessa sessione"?
2. **Prezzi dei cambi**: acquisto a **Qt.A corrente** e vendita con rientro a **Qt.A
   corrente** (default)? O rientro al prezzo pagato?
3. **Cambio gratuito (fuori lista)**: rimborso del giocatore uscito = **prezzo pagato**
   e sostituto pagato a Qt.A corrente (default)? O altro?
4. **Audit log** (registro di chi fa cosa: login, acquisti, azioni admin, con data/ora,
   utile per contestazioni): default **sì**, costo ~mezza giornata.
