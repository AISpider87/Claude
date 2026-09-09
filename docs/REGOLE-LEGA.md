# Regole della SuperLega 2026/27 — sintesi per l'app

> Fonte: `RegolamentoSuperlega_202627.pdf` (6 pagine, fornito dall'admin) + chiarimenti in chat.
> Questa sintesi copre solo ciò che serve all'app v1 (gestione rose e mercato).
> Punteggi, formazioni e competizioni (Campionato, Champions/Europa/Conference, Coppa del
> Riscatto) sono nel regolamento ma **fuori scope v1** → `docs/BACKLOG.md`.

## Lega

- Nome: **SuperLega 2026/27** — 20 partecipanti, una squadra a testa.
- Quota reale 100 €/squadra e montepremi 2.000 € (gestiti fuori dall'app; al più una nota informativa).

## Rose e budget

- Budget iniziale: **250 fanta-milioni** ("Magic Euro") per squadra.
- Rosa obbligatoria: **23 calciatori = 3P / 7D / 7C / 6A** (modalità Classic).
- Il budget non speso resta disponibile per i mercati successivi.
- Mercato precampionato: chiuso il 21/08/2026 ore 22:30 sul sito Leghe Fantacalcio
  (già avvenuto → le rose iniziali si importano dall'export "Rose", `fixtures/rose_superlega_export.xlsx`).
- **Extra budget: +5 fanta-milioni** a squadra all'apertura di ciascuna delle 4 sessioni
  di mercato (dopo le giornate 3, 13, 23, 30).

## Proprietà dei giocatori (modello NON esclusivo)

- **Lo stesso calciatore può appartenere a più squadre contemporaneamente** (confermato
  dall'export: es. Meret e Martinez L. in molte rose). Nessun vincolo di unicità.
- "**Svincolato**" = calciatore del listone che non appartiene a **nessuna** squadra della lega.
- Nelle sessioni di mercato (riparazione) si possono acquistare **solo svincolati**.
- La lista svincolati è **fotografata all'apertura della sessione**: durante la stessa
  sessione più squadre possono acquistare lo stesso svincolato; dalla sessione successiva,
  chi è stato preso non è più disponibile. _(Confermato dall'admin il 2026-09-09.)_
- Non esiste quindi il problema "due squadre si contendono lo stesso giocatore":
  niente aste né code, nessuna esclusività da garantire a livello di transazione.

## Sessioni di mercato (FantaMercato)

- 4 sessioni: dopo il 3° turno (06/09/2026), il 13° (29/11/2026), il 23° (07/02/2027),
  il 30° (04/04/2027).
- I cambi si comunicano **entro le 20:00 del giovedì successivo** all'apertura
  (oggi via file Excel dell'admin; l'app sostituisce questo flusso).
- **Limite: 20 compravendite ("cambi") a squadra per l'intera stagione**; nessun limite
  per singola sessione. **Scambi di calciatori tra squadre vietati.**

## Calciatori usciti dalla Serie A ("fuori lista")

- Chi lascia la Serie A (ceduto all'estero, in B, ecc.) è contrassegnato con `*`
  (nell'export rose) e compare nel foglio "Ceduti" del file quotazioni.
- La loro sostituzione è un **cambio gratuito**: non conta nel limite dei 20.
- Si può fare **in qualsiasi momento** (non solo in sessione), entro le 19:00 del giovedì
  (turno infrasettimanale: entro le 14:00 del martedì che anticipa la giornata, oppure
  entro le 22:00 del venerdì che la posticipa).
- Economia del cambio gratuito (confermata dall'admin): rimborso = **prezzo pagato**,
  sostituto pagato a **Qt.A attuale**.

## Prezzi (confermati dall'admin — il regolamento non li esplicita)

- Acquisto: **Qt.A corrente** dell'ultimo listone importato, al momento dell'operazione.
- Vendita (dentro un cambio): rientro = **Qt.A corrente**.
- Dall'export risulta che il prezzo pagato al precampionato = quotazione al momento
  dell'acquisto (es. Dimarco 32 = Qt.I).

## File ufficiali

- Quotazioni: `Quotazioni_Fantacalcio_Stagione_YYYY_YY.xlsx` — fogli `Tutti`, `Portieri`,
  `Difensori`, `Centrocampisti`, `Attaccanti`, `Ceduti`; riga 1 titolo, riga 2 intestazioni
  `Id, R, RM, Nome, Squadra, Qt.A, Qt.I, Diff., Qt.A M, Qt.I M, Diff.M, FVM, FVM M`.
  Fixture: `fixtures/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx` (532 calciatori nel foglio Tutti, 62 nel foglio Ceduti).
  Il foglio **Ceduti** permette di marcare automaticamente i "fuori lista".
- Export rose di Leghe Fantacalcio: foglio `ROSE`, squadre affiancate a blocchi di 3 colonne
  (`nome squadra | costo | vuota`), 12 squadre nel primo blocco (righe 1–25) e 8 nel secondo
  (righe 27–51); 23 giocatori + riga `totale` per squadra; giocatori identificati **per nome**
  (non per Id → matching col listone con gestione anomalie); `*` = fuori lista.
  Crediti residui = 250 − totale. Fixture: `fixtures/rose_superlega_export.xlsx`.
