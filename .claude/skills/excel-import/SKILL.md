---
name: excel-import
description: Parsing procedures and column mapping for Fantacalcio.it quotations and Leghe Fantacalcio roster exports, fixtures, and anomaly checklist. Load when touching any parser or import flow.
---

# Excel import — procedures

Fixtures reali (usarle SEMPRE nei test): `fixtures/Quotazioni_Fantacalcio_
Stagione_2026_27.xlsx`, `fixtures/rose_superlega_export.xlsx`. Parser lato
server con SheetJS; mai fidarsi del layout: individuare, mappare, validare.

## Quotazioni (`Quotazioni_Fantacalcio_Stagione_YYYY_YY.xlsx`)

- Fogli: `Tutti` (fonte primaria, ~533 righe), `Portieri/Difensori/
  Centrocampisti/Attaccanti` (ridondanti, ignorare), `Ceduti` (→ out_of_list).
- Riga 1 titolo; intestazioni alla riga trovata cercando una riga che contiene
  sia "Nome" sia "Squadra" (non assumere riga 2).
- Colonne mappate PER NOME (case/punteggiatura-insensitive):
  `Id, R, RM, Nome, Squadra, Qt.A, Qt.I, Diff., Qt.A M, Qt.I M, Diff.M, FVM, FVM M`.
  Colonne sconosciute: ignorate con log. Numeri possono arrivare come stringhe.
- Riga senza Id numerico → scartata e registrata come anomalia.
- Upsert per Id. Dopo l'upsert: giocatori attivi assenti dal file → out_of_list
  (mai delete). Snapshot in player_quotations per ogni import applicato.
- Diff preview prima di applicare: nuovi / aggiornati (con delta Qt.A) / usciti
  / anomalie. L'import manuale applica solo dopo conferma admin.

## Export rose Leghe Fantacalcio (foglio `ROSE`)

- Blocchi affiancati di 3 colonne per squadra: `nome squadra | costo | vuota`;
  più fasce verticali di blocchi separate da una riga vuota (fixture: 12 squadre
  righe 1–25, poi 8 squadre righe 27–51).
- Per squadra: 23 giocatori (3P/7D/7C/6A in ordine) + riga `totale`.
- `Nome *` (suffisso asterisco) = fuori lista: importare e marcare.
- Crediti residui squadra = initial_budget (250) − totale.
- Matching per NOME contro il listone: normalizzare (trim, case, accenti);
  match esatto → ok; match multiplo o nessun match → anomalia da risolvere
  manualmente in UI, MAI auto-scegliere. Prezzo pagato = colonna costo.

## Checklist anomalie (ogni import produce un report)

- [ ] righe senza Id / senza nome
- [ ] nomi non trovati nel listone (rose)
- [ ] nomi ambigui (più candidati)
- [ ] totale squadra ≠ somma costi
- [ ] rosa ≠ 23 o composizione ≠ 3/7/7/6
- [ ] valori non numerici in colonne numeriche
- [ ] variazioni Qt.A oltre soglia (default ±5) → segnalate all'admin
- [ ] import ripetuto dello stesso file → zero modifiche (idempotenza)
