# BACKLOG — v2 e oltre

Fuori scope v1, registrati per il futuro. Niente qui è promesso.

## Dal regolamento (grosso: il "gioco" vero e proprio)

- Punteggi e voti (fonte Italia), bonus/malus, modificatore difesa.
- Formazioni: moduli consentiti, 11+12, ordine panchina, 3 sostituzioni,
  regole prima giornata (60 punti), consegna entro 1' dal via.
- Competizioni: Campionato a somma punti; Champions/Europa/Conference (gironi
  A/B, conversione punti→gol, semifinali, finalissima); Coppa del Riscatto
  (giornate 31–38, punteggio Formula 1).
- Variazioni di calendario, 6 politico, partite sospese.
- Premi e quote (montepremi 2.000 €) — al più pagina informativa.

## Prodotto

- Notifiche push (PWA) e promemoria scadenza cambi (giovedì 20:00 / regole
  infrasettimanale del regolamento).
- Realtime sugli svincolati durante la sessione (v1: refresh/poll leggero).
- Login Google/OAuth; multi-lega; stagioni successive con rollover.
- Asta live per il mercato precampionato (in lega esiste già un tool: `legacy/`).
- Statistiche avanzate: andamento valore rosa, plusvalenze, confronto squadre.

## Rinviati dall'admin (2026-09-11)

- **Messaggi programmati alla lega** (es. "consegnare la formazione entro le
  15"): WhatsApp non permette l'invio automatico nei gruppi (API ufficiale
  senza gruppi, strumenti non ufficiali a rischio ban). Opzioni valutate e
  proposte: bot Telegram (gratis, automatico, invio dal DB) oppure WhatsApp
  semi-automatico (notifica all'admin con testo pronto e pulsante "Invia su
  WhatsApp"). L'admin ha scelto di rinviare.
- **Fonte automatica per gli indisponibili** (Fantacalcio.it o API-Football):
  da verificare termini d'uso e piano gratuito dal computer dell'admin; oggi
  gli stati si inseriscono a mano da _Admin → Indisponibili_.

## Esclusi per sempre (regolamento)

- Scambi di calciatori tra squadre: **vietati**.

## Sicurezza (post v1)

- Content-Security-Policy con nonce per richiesta (script inline di Next e
  script del tema), da configurare nel proxy.
