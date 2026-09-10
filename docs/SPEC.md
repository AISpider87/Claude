# SPEC — SuperLega (v1) — requisiti congelati

> Fonti: `BRIEF` iniziale, `docs/REGOLE-LEGA.md` (regolamento SuperLega 2026/27),
> risposte dell'admin in Fase 0 (chiusa il 2026-09-09).
> Ogni modifica a questo documento richiede l'ok esplicito dell'admin (Daniele).

## 1. Prodotto

App web (PWA installabile) per la gestione delle rose della **SuperLega 2026/27**:
20 squadre, modalità **Classic**, listone e quotazioni da **Fantacalcio.it**.
Interfaccia in **italiano**; codice, commit e identificatori in inglese.
Costo di esercizio: **0 €/mese** (Vercel Hobby + Supabase Free + Resend Free).

Fuori scope v1 (→ `docs/BACKLOG.md`): punteggi, voti, formazioni, classifiche e le
competizioni del regolamento (Campionato, Champions/Europa/Conference, Coppa del
Riscatto), asta live, notifiche push, multi-lega. Scambi tra squadre: **vietati dal
regolamento**, non si faranno mai.

## 2. Utenti e ruoli

- Registrazione email/password con **verifica email** e recupero password.
- Iscrizione protetta da **codice lega** (impostato dall'admin, modificabile).
- Ruoli: `admin` e `manager`. Primo admin da seed: `danielgiordan87@hotmail.it`.
  Altri admin (previsti 2) promossi solo da un admin. Niente login Google in v1.
- Ogni manager possiede esattamente una squadra (nome, sigla, colori/emblema
  generato, crediti). Le 20 squadre e i nomi esistono già (import iniziale).
- **Privacy** (modifica approvata dall'admin il 2026-09-10): ogni manager vede
  solo la propria rosa, i propri crediti e le proprie operazioni; l'admin vede
  tutto. La lega vede di ogni squadra solo nome, sigla, colori e manager. La
  lista svincolati resta calcolata su tutte le rose (dice che un calciatore è
  posseduto, non da chi). Applicato con RLS, non solo in UI.

## 3. Regole di dominio (dal regolamento — implementate come `league_settings`)

- Budget iniziale **250** fanta-milioni interi; residuo riportato tra i mercati;
  **+5** a squadra a ogni apertura di sessione. **Crediti negativi vietati.**
- Rosa obbligatoria: **23 = 3P / 7D / 7C / 6A**.
- **Proprietà non esclusiva**: lo stesso calciatore può appartenere a più squadre.
- **Svincolato** = calciatore del listone attivo posseduto da **nessuna** squadra.
- **Sessioni di mercato** (4/stagione, dopo le giornate 3, 13, 23, 30): create
  dall'admin con nome, apertura e chiusura (Europe/Rome); si aprono e chiudono
  da sole agli orari (apribili/chiudibili anche a mano, in anticipo). All'apertura la lista svincolati viene **fotografata**: nella stessa
  sessione più squadre possono comprare lo stesso svincolato; dalla sessione
  successiva chi è posseduto non è più acquistabile.
- **Operazioni separate** (modifica approvata dall'admin il 2026-09-10; in
  origine "cambio" atomico): a sessione aperta il manager **svincola** un
  proprio giocatore (rientro = Qt.A attuale, si apre un posto nel suo ruolo) e
  **acquista** svincolati solo nei ruoli con posti liberi (chi esce difensore
  rientra difensore). Ogni acquisto usa uno dei **20 cambi a stagione** per
  squadra (nessun limite per sessione); gli svincoli non contano. Alla chiusura
  la rosa deve tornare 3/7/7/6: i posti vuoti finiscono nel report.
- **Prezzi: sempre quotazione attuale (Qt.A)** dell'ultimo listone importato, sia
  per l'acquisto sia per il rientro della vendita.
- **Fuori lista** (usciti dalla Serie A, foglio "Ceduti" / asterisco, o assenti
  dal listone all'import delle rose): **svincolo gratuito** in qualsiasi momento
  (rimborso = **prezzo pagato**) e acquisto del sostituto dello stesso ruolo, tra
  gli svincolati liberi adesso, a **Qt.A attuale**, anche fuori sessione e senza
  contare nei 20. I fuori lista restano visibili nello storico, mai cancellati.
- Alla chiusura di una sessione: validazione delle rose (23, 3/7/7/6, crediti ≥ 0)
  e report per l'admin.
- Ogni operazione è registrata in modo **immutabile** con snapshot del prezzo;
  l'annullamento è solo admin, con motivazione, e crea l'operazione inversa.
- Fuori sessione le rose sono in sola lettura (unica eccezione: svincolo
  gratuito dei fuori lista e relativo sostituto), applicato lato server (RLS +
  funzioni DB), anche via API diretta.

## 4. Listone e quotazioni

- Import da Excel Fantacalcio.it (`fixtures/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx`).
  Upsert per **Id Fantacalcio**; mai per nome. Parser tollerante: intestazioni
  trovate cercando "Nome"/"Squadra", mappa per nome colonna, ignora colonne ignote,
  scarta righe senza Id, logga anomalie. Foglio **Ceduti** → stato `fuori lista`.
- Campi: id, nome, squadra Serie A, ruolo classic, ruolo mantra, Qt.A, Qt.I, Diff,
  FVM (+ varianti Mantra), stato, updated_at. Snapshot storico a ogni import con
  grafico andamento nella scheda giocatore.
- **Sync automatico**: job 1×/giorno ore 06:00 Europe/Rome con sorgente pluggable;
  se il download da Fantacalcio.it non è possibile/consentito (da verificare in M5:
  robots.txt, login, ToS), resta garantito l'**upload manuale** dell'admin con
  anteprima delle differenze prima della conferma. Log di ogni import (nuovi,
  aggiornati, usciti, variazioni rilevanti); notifica admin per i fuori lista.
- Ricerca istantanea e filtri (ruolo, squadra, range quotazione, solo svincolati,
  ordinamenti) su ~530–700 calciatori.

## 5. Import rose

- Formato ufficiale: export "Rose" di Leghe Fantacalcio (`fixtures/rose_superlega_export.xlsx`):
  foglio `ROSE`, blocchi di 3 colonne per squadra, 23 giocatori + riga `totale`,
  matching **per nome** contro il listone con report anomalie e conferma manuale
  dei casi ambigui; `*` = fuori lista; crediti residui = 250 − totale.
- In alternativa: assegnazione manuale da UI admin e import CSV semplice
  (squadra, id/nome, prezzo).

## 6. Pannello admin

Gestione utenti (ruoli, reset, disattivazione), squadre (nome, crediti), rose,
sessioni, import listone/rose con anteprima, log import e operazioni, impostazioni
lega (incluso codice lega), annullamento operazioni, export Excel (rose, listone,
operazioni), **audit log** (login, operazioni, azioni admin).

## 7. Notifiche email (v1)

Apertura sessione e riepilogo alla chiusura, via Resend free tier. Il resto in backlog.

## 8. Requisiti non funzionali

Come da brief §4: HTTPS su dominio Vercel; mobile-first (iOS Safari/Android Chrome,
safe-area, `100dvh`, tap ≥ 44px); PWA (manifest, icone, service worker app-shell,
no offline per il mercato); sicurezza server-side (RLS + funzioni DB, Zod, rate
limiting su login e operazioni, OWASP Top 10, secrets solo in env); Lighthouse
mobile ≥ 90; UTC nel DB, Europe/Rome in UI; contrasto AA; backup: script export DB
e export Excel admin; keep-alive per la pausa di Supabase Free.

## 9. Design

Nome app: **SuperLega**. Direzione "calcio futuristico" (brief §7) con palette
vincolata a **blu chiaro / blu scuro / nero**; logo inventato (niente loghi
ufficiali, foto o imitazioni EA FC). Tema scuro di default, chiaro selezionabile.
Dettagli in `docs/DESIGN.md`.

## 10. Definition of done (v1)

Come da brief §11, con una modifica: il test di concorrenza non verifica più
l'esclusività (acquisti multipli dello stesso svincolato sono leciti) ma
l'**integrità di crediti e limiti sotto operazioni simultanee** (mai crediti
negativi, mai oltre 20 cambi, mai rosa oltre i limiti di ruolo).
