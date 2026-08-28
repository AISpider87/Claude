# Battitore d'Asta

Applicazione per l'aggiudicazione all'asta: si preme il martelletto, scorrono
5 secondi in silenzio, poi partono i 3 colpi che scandiscono gli ultimi
3 secondi — con l'ultimo colpo ritardato di 2 secondi in più.

## Come si avvia (MacBook Pro M5)

Doppio clic su **`avvia.command`**, oppure doppio clic direttamente su
`index.html`. Non serve installare nulla: è un unico file autosufficiente,
funziona offline in Safari o Chrome.

> Alla prima apertura di `avvia.command` macOS può chiedere conferma:
> tasto destro → *Apri* → *Apri*.

Per la modalità a schermo intero: `Ctrl + Cmd + F` in Safari.

## Sequenza

| Istante | Cosa succede |
|---------|--------------|
| 0 s | Pressione del martelletto, parte il cronometro |
| 0 → 5 s | Attesa silenziosa: i secondi trascorsi scorrono a schermo (0 → 4) |
| 5 s | **1º colpo** — conteggio "3" |
| 6 s | **2º colpo** — conteggio "2" |
| 8 s | **3º colpo** — conteggio "1", ritardato di 2 secondi in più |
| 9,2 s | Schermata *AGGIUDICATO* — clic o barra spaziatrice per ribattere |

## Comandi

- **Batti** (o barra spaziatrice) — avvia la sequenza. Il pulsante resta sempre
  a schermo: premendolo a conteggio avviato la sequenza riparte da zero e i
  colpi gia' programmati vengono zittiti
- **Azzera** (o `Esc`) — ferma e riporta tutto a zero

## Pacchetto per macOS

La cartella `mac/` contiene i pezzi del bundle `Battitore d'Asta.app`:
`Info.plist`, lo script di avvio `BattitoreAsta`, l'icona `icona.icns` e
l'installatore `INSTALLA.command`.

## Note tecniche

- I tre colpi sono programmati sul clock dell'`AudioContext`, quindi la
  cadenza resta precisa anche se la grafica perde qualche fotogramma.
- Il suono è sintetizzato in tempo reale (impatto di rumore filtrato +
  componenti tonali): nessun file audio esterno. Il terzo colpo è più grave,
  più pieno e con coda risonante, come la battuta finale del martelletto.
- L'uscita passa da un compressore, così il colpo finale resta forte senza
  saturare (picco verificato a 0,88 su fondo scala).
- Per modificare i tempi basta cambiare le costanti `ATTESA` e `COLPI`
  in cima allo script dentro `index.html`.

---

## Altri progetti in questo repository

- **`birra/`** — [Luppolo Nostrano](birra/README.md): negozio online di birre
  artigianali italiane, con catalogo, carrello, checkout e pagamento con carta
  (Stripe). Si apre con doppio clic su `birra/apri-negozio.command`.
