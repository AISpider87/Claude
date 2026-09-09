# Fase 0 — Domande e default proposti

> Stato: **in attesa di risposte**. Rispondere anche solo con "ok ai default tranne…".
> Le risposte confermate verranno congelate in `docs/SPEC.md` (Fase 1).

## Nota preliminare (verifiche fatte)

- **Repository**: contiene già `index.html`, `avvia.command` e `mac/` (tool asta esistente).
  Proposta (default): spostarli in `legacy/` e sviluppare la nuova app alla radice del repo.
- **Fantacalcio.it**: dall'ambiente di sviluppo remoto il dominio `fantacalcio.it` è bloccato
  dal proxy di rete, quindi la verifica del download automatico (URL, login, robots.txt,
  termini d'uso) non è ancora stata eseguita. Verrà fatta in M5; in ogni caso la sorgente
  sarà "pluggable" e l'upload manuale dell'admin resta il percorso garantito (come da brief §3.6).

---

## Blocco A — Lega, rose, crediti

| # | Domanda | Default proposto |
|---|---------|------------------|
| A1 | Nome della lega, numero di squadre, stagione | Stagione **2025/26**; nome e numero squadre: **da indicare** (ipotesi 8–10) |
| A2 | Modalità Classic o Mantra | **Classic** (P/D/C/A) — Mantra resta predisposto nel modello dati ma fuori scope v1 |
| A3 | Composizione rosa | **25 giocatori: 3P / 8D / 8C / 6A** |
| A4 | Crediti iniziali per squadra | **500 fantacrediti interi** (niente centesimi) |
| A5 | Crediti residui post-asta: come vengono forniti | **File/elenco fornito dall'admin** (import iniziale insieme alle rose) |
| A6 | Regola di vendita | **Rientro = Qt.A corrente** al momento della vendita (configurabile in `league_settings`) |
| A7 | Giocatori usciti dal listone | **Svincolo automatico alla chiusura della finestra successiva NO — restano in rosa come "fuori lista"; l'admin decide caso per caso lo svincolo con rimborso = ultima Qt.A nota** |

## Blocco B — Mercato

| # | Domanda | Default proposto |
|---|---------|------------------|
| B1 | Prezzo di acquisto | **Qt.A corrente** al momento della conferma |
| B2 | Conflitti sullo stesso svincolato | **Vince il primo che conferma** (transazione atomica lato DB). Alternativa consigliata da valutare: offerte sigillate risolte a chiusura finestra (vedi Proposte) |
| B3 | Limiti operazioni | **Nessun limite** per finestra/stagione (configurabile) |
| B4 | Limiti di ruolo durante la finestra | **Si può stare sotto** i limiti durante la finestra, **mai sopra**; alla chiusura la validazione segnala le rose incomplete all'admin (non blocca) |
| B5 | Crediti negativi | **Sempre vietati** |
| B6 | Trasparenza | **Rose, crediti e registro operazioni visibili a tutti i membri della lega; bacheca mercato pubblica (interna alla lega)** |

## Blocco C — Accessi, dati, hosting, design

| # | Domanda | Default proposto |
|---|---------|------------------|
| C1 | Iscrizione | **Aperta con codice lega** + verifica email **sì**; login Google **no** in v1 |
| C2 | Fonte quotazioni | **Fantacalcio.it confermata**. Servono subito: **un file Excel reale delle quotazioni** e, se disponibile, **l'export "Rose" di Leghe Fantacalcio** |
| C3 | Frequenza aggiornamento automatico | **1 volta al giorno, 06:00 Europe/Rome** (Vercel Cron, compatibile col limite Hobby) |
| C4 | Hosting | **Vercel Hobby + Supabase Free (0 €/mese)**, dominio di default Vercel. Da confermare: account GitHub/Vercel/Supabase esistenti, eventuale dominio personalizzato |
| C5 | Notifiche email v1 | **Sì**, solo apertura finestra + riepilogo chiusura, via **Resend free tier** |
| C6 | Nome dell'app | **Da indicare** (proposta segnaposto: "FantaHub"); colori: direzione "calcio futuristico" del brief §7; logo: **avatar/emblema generato**, nessun logo esistente |
| C7 | Admin | **Da indicare: email degli admin** (2–3). Il primo admin via seed con l'email del proprietario del progetto |
| C8 | File esistenti nel repo | **Spostare `index.html`, `avvia.command`, `mac/` in `legacy/`** e sviluppare l'app alla radice |

---

## Proposte di miglioramento (impatto stimato)

1. **Offerte sigillate a chiusura finestra** invece di "primo che conferma": più equo se i manager
   hanno orari diversi; spareggio suggerito: offerta più alta vince, a parità vince chi ha meno
   crediti residui, poi sorteggio. Impatto: **+2–3 giorni** (UI offerte, risoluzione batch, notifiche).
   Consiglio: v1 con "primo che conferma", offerte in v2 — oppure subito se per voi è un punto caldo.
2. **Sessione di prova pre go-live**: lega finta con dati seed, 2–3 giorni di test con gli amici
   prima dell'apertura vera. Impatto: **quasi nullo** (riuso del seed). Consiglio: **sì**.
3. **Keep-alive Supabase Free**: il database si mette in pausa dopo ~7 giorni di inattività;
   previsto un ping schedulato dal cron giornaliero. Impatto: nullo. Consiglio: **sì**.
4. **Scambi tra manager**: fuori scope v1 come da brief, registrato in `docs/BACKLOG.md`.
5. **Log accessi/audit visibile all'admin** (chi ha fatto cosa e quando): già implicito nel
   registro operazioni, esteso a login e modifiche admin. Impatto: **+0,5 giorni**. Consiglio: **sì**.
