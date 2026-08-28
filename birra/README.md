# Luppolo Nostrano — negozio online di birre artigianali

Sito di vendita pronto all'uso: catalogo, carrello, checkout e **pagamento con
carta di credito**. Funziona anche senza server (ordini via WhatsApp, email o
bonifico); il pagamento online si attiva avviando il piccolo server in
`server/`.

```
birra/
├── index.html          il negozio (tutta la grafica e la logica)
├── prodotti.js         ← IL FILE DA MODIFICARE: listino, prezzi, regole, contatti
├── apri-negozio.command  doppio clic per aprire il sito sul Mac
└── server/
    ├── server.js       crea i pagamenti Stripe e ricalcola i totali
    ├── package.json
    └── .env.esempio    da copiare in .env con le tue chiavi
```

---

## 1. Guardarlo subito

Doppio clic su **`apri-negozio.command`** (o direttamente su `index.html`).
Non serve installare niente: il negozio si apre in Safari o Chrome e funziona
offline, tranne i caratteri tipografici che arrivano da Google Fonts.

## 2. Mettere le tue birre

Apri **`prodotti.js`** con un editor di testo. È l'unico file da toccare.

**In cima** ci sono i dati del negozio: nome, email, numero WhatsApp, partita
IVA, costi di spedizione, soglia del porto franco, ordine minimo, sconto cassa.

**Sotto** c'è il listino. Ogni birra è una riga così:

```js
{ id:"solenne-ipa", nome:"Solenne", birrificio:"Birrificio Valdimonte",
  stile:"IPA", regione:"Piemonte", abv:6.2, ibu:58, formato:33, prezzo:4.20,
  cartone:12, scorta:120, colore:"#c9701f", tag:["bestseller"],
  descrizione:"...", abbinamento:"...", ingredienti:"..." }
```

| Campo | A cosa serve |
|---|---|
| `id` | codice interno. **Non cambiarlo** dopo il primo ordine |
| `prezzo` | prezzo al pubblico **IVA inclusa**, per bottiglia |
| `formato` | centilitri: 33, 50, 75 |
| `cartone` | pezzi per cassa: chi ne compra una cassa intera ha lo sconto |
| `scorta` | pezzi disponibili. A 0 la birra risulta esaurita e non vendibile |
| `colore` | colore dell'etichetta disegnata sul sito (codice esadecimale) |
| `tag` | `"novita"`, `"bestseller"`, `"regalo"` — anche vuoto: `[]` |

Il disegno delle bottiglie è generato dal sito: **non servono fotografie**.
Quando avrai le foto vere possiamo sostituirle.

> **Calcolo del margine.** Il campo del prezzo di acquisto dal grossista non è
> incluso di proposito: `prodotti.js` finisce online e sarebbe visibile ai
> clienti. Se ti serve un pannello con margini e valore di magazzino lo
> facciamo a parte, in un file da tenere solo sul tuo computer.

## 3. Pubblicare il sito (gratis)

Il modo più semplice è **GitHub Pages**: nelle impostazioni del repository
(*Settings → Pages*) scegli il ramo da pubblicare e il negozio sarà
raggiungibile a `https://tuo-utente.github.io/claude/birra/`.
Per un indirizzo tuo (`www.nomedelnegozio.it`) si compra il dominio e lo si
punta a GitHub Pages, oppure si usa Netlify o Vercel: cambia poco.

## 4. Attivare il pagamento con carta

Il browser non può parlare direttamente con Stripe in sicurezza: i prezzi
vanno ricalcolati su un server, altrimenti chiunque potrebbe modificare la
pagina e pagare un euro. Il server in `server/` fa esattamente questo — riceve
solo gli **id** dei prodotti e le quantità, e rifà i conti sul listino vero.

1. Crea un account su [stripe.com](https://stripe.com) (per l'Italia serve
   partita IVA e IBAN; le commissioni sono a transazione).
2. Nel terminale:
   ```bash
   cd birra/server
   npm install
   cp .env.esempio .env
   ```
3. Apri `.env` e incolla la tua **chiave segreta** (`sk_test_…` per le prove).
   Il file `.env` non va mai messo su GitHub: è già escluso.
4. Avvia il server:
   ```bash
   npm start
   ```
5. In `prodotti.js` scrivi l'indirizzo che il server stampa a video:
   ```js
   stripeEndpoint: "http://localhost:4242/crea-pagamento",
   ```
6. Ricarica il negozio: il metodo "Carta, Apple Pay, Google Pay" è attivo.
   Con le chiavi di prova usa la carta **4242 4242 4242 4242**, scadenza
   futura, CVC qualsiasi: non viene addebitato niente.

**Per vendere davvero** servono due cose in più: le chiavi `sk_live_…` e un
server sempre acceso (Render, Railway, Fly.io o un VPS costano pochi euro al
mese). Poi in `.env` metti il dominio del negozio in `ORIGINI_AMMESSE` e in
`prodotti.js` l'indirizzo pubblico del server.

### Conferme automatiche degli ordini

Il server registra ogni ordine in `server/ordini/ordini.jsonl` e, se configuri
il webhook di Stripe, segna anche l'incasso:

```bash
stripe listen --forward-to localhost:4242/webhook   # in prova
```
Copia il `whsec_…` che compare in `STRIPE_WEBHOOK_SEGRETO`.
Quando un ordine viene pagato, il server lo scrive a video e nel registro.
**Le scorte non si aggiornano da sole**: dopo ogni spedizione abbassa il campo
`scorta` in `prodotti.js`.

## 5. Prima di vendere davvero

Vendere alcolici online in Italia richiede qualche adempimento. Da verificare
con il tuo commercialista e con lo Sportello Unico del Comune:

- partita IVA con codice ATECO del commercio elettronico al dettaglio;
- iscrizione al Registro delle Imprese e SCIA al SUAP per la vendita online;
- notifica sanitaria all'ASL come operatore del settore alimentare;
- licenza dell'Agenzia delle Dogane e Monopoli per la vendita di alcolici;
- divieto di vendita ai minori di 18 anni (già gestito dal sito, ma va
  richiesto anche il documento alla consegna);
- condizioni di vendita, informativa privacy e diritto di recesso: nel sito ci
  sono i testi di base, con i tuoi dati fiscali da inserire in `prodotti.js`.

## 6. Cosa fa il sito, in breve

- catalogo con ricerca, filtri per stile, formato e regione, ordinamenti;
- schede prodotto con gradazione, IBU, abbinamenti, ingredienti, disponibilità;
- carrello che resta salvato nel browser anche chiudendo la pagina;
- sconto automatico sulla cassa intera, spedizione gratuita oltre soglia,
  supplemento isole, ordine minimo;
- checkout con validazione dei dati, conferma dei 18 anni e delle condizioni;
- quattro modi di concludere: carta, bonifico (con IBAN e causale), WhatsApp
  con l'ordine già scritto, email;
- verifica dell'età all'ingresso, testi legali, sito leggibile da telefono.
