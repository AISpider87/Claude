---
name: fantacalcio-domain
description: SuperLega domain glossary, league rules, edge cases, and Fantacalcio.it file formats. Load when implementing or reviewing any domain logic.
---

# Fantacalcio domain — SuperLega

Authority chain: `docs/SPEC.md` §3 > `docs/REGOLE-LEGA.md` > this file.

## Glossario

- **Listone**: elenco completo dei calciatori quotati da Fantacalcio.it.
- **Qt.A / Qt.I / FVM**: quotazione attuale / iniziale / valore di mercato.
- **Svincolato**: calciatore `active` posseduto da **nessuna** squadra della lega
  (vista derivata, non tabella).
- **Fuori lista**: uscito dalla Serie A (foglio "Ceduti", suffisso `*` negli
  export). Mai cancellato, solo `status = out_of_list`.
- **Cambio**: vendita di un posseduto + acquisto di uno svincolato dello stesso
  ruolo. Unica operazione di mercato della v1.
- **Sessione**: finestra di mercato (4/stagione). Stati scheduled → open → closed.

## Regole non ovvie (facili da sbagliare)

1. **La proprietà NON è esclusiva**: Meret può stare in 6 rose. Nessun vincolo
   di unicità globale su roster_players.
2. La lista svincolati è **fotografata all'apertura** della sessione
   (`session_free_agents`): due squadre possono comprare lo stesso svincolato
   nella stessa sessione — comportamento corretto, non un bug.
3. Prezzi **sempre Qt.A dell'ultimo listone importato**, sia in acquisto sia come
   rientro vendita. Eccezione: rimborso del fuori lista = **prezzo pagato**.
4. Il cambio gratuito (fuori lista) non conta nei 20 e vale **anche a sessione
   chiusa**; lo svincolato entrante si valuta sullo stato attuale (non su una
   foto di sessione).
5. `swaps_used` è per squadra e per stagione (limite 20); l'annullamento admin
   di un cambio che contava lo decrementa.
6. +5 crediti a TUTTE le squadre a ogni `open_market_session`, una sola volta
   per sessione (idempotenza se la open viene ritentata).
7. Rosa a regime = esattamente 23 (3P/7D/7C/6A); durante una sessione può
   essere temporaneamente diversa solo dentro la transazione di un cambio
   (out+in atomici). Crediti mai negativi, in nessun istante osservabile.
8. Import listone: upsert per **Id**, mai per nome (i nomi cambiano: "Martinez
   Jo.", "Milinkovic-Savic V.").

## Casi limite noti

- Giocatore fuori lista presente in più rose: ogni squadra fa il proprio cambio
  gratuito, indipendentemente.
- Giocatore che rientra nel listone dopo essere uscito: torna `active`
  (upsert per Id), le rose non cambiano da sole.
- Omonimi/varianti nome nell'export rose: mai auto-assegnare, sempre report
  anomalie + conferma manuale admin.
- Squadra senza owner (manager non ancora registrato): rosa visibile, nessuna
  operazione possibile finché l'admin non collega l'account.
