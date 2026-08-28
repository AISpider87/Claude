/* ============================================================
   LUPPOLO NOSTRANO — catalogo e configurazione del negozio
   ------------------------------------------------------------
   QUESTO E' L'UNICO FILE DA MODIFICARE PER GESTIRE IL NEGOZIO.
   Lo leggono sia il sito (index.html) sia il server dei
   pagamenti (server/server.js): i prezzi validi sono questi.
   ============================================================ */

const CONFIG = {
  /* --- Identita' del negozio (nome provvisorio: cambialo qui) --- */
  nome:        "Luppolo Nostrano",
  sottotitolo: "Birre artigianali italiane, dal birrificio a casa tua",
  claim:       "Selezioniamo microbirrifici italiani e te li portiamo a casa in 48 ore.",

  /* --- Contatti (SOSTITUISCI con i tuoi dati reali) --- */
  email:     "ordini@luppolonostrano.it",
  telefono:  "+39 000 000 0000",
  whatsapp:  "393000000000",          // solo cifre, con prefisso 39, senza + e senza spazi
  citta:     "Torino",
  indirizzo: "Via del Malto 12, 10100 Torino (TO)",

  /* --- Dati fiscali obbligatori in fondo al sito --- */
  ragioneSociale: "Nome Cognome / Ditta individuale",
  piva:           "IT00000000000",
  rea:            "TO-0000000",

  /* --- Regole commerciali --- */
  iva:              22,      // % gia' inclusa nei prezzi indicati
  spedizione:       7.90,    // costo corriere standard
  spedizioneIsole:  12.90,   // Sicilia, Sardegna e isole minori
  sogliaPortoFranco: 79,     // sopra questo imponibile la spedizione e' gratis
  ordineMinimo:     15,      // sotto questa cifra il carrello non si chiude
  scontoCassa:      10,      // % di sconto quando prendi una cassa intera
  valuta:           "EUR",

  /* --- Pagamenti --- */
  pagamenti: {
    // Carta di credito / Apple Pay / Google Pay via Stripe Checkout.
    // Lascia "" finche' non avvii il server in server/: il sito continua a
    // funzionare con WhatsApp, email e bonifico.
    // In locale:    http://localhost:4242/crea-pagamento
    // In produzione: https://tuo-dominio.it/crea-pagamento
    stripeEndpoint: "",

    bonifico: {
      attivo:    true,
      intestato: "Nome Cognome",
      iban:      "IT00 X000 0000 0000 0000 0000 000",
      banca:     "Nome della banca"
    },
    contrassegno: { attivo: false, supplemento: 4.00 }
  },

  /* --- Consegna --- */
  consegna: "Spedizione con corriere espresso in 24/48 ore lavorative. " +
            "Imballo antiurto certificato per il vetro.",

  /* --- Province considerate isole per il calcolo spedizione --- */
  provinceIsole: ["AG","CL","CT","EN","ME","PA","RG","SR","TP",
                  "CA","CI","NU","OG","OR","OT","SS","SU","VS"]
};

/* ============================================================
   CATALOGO
   ------------------------------------------------------------
   I dati qui sotto sono di ESEMPIO: nomi di fantasia, prezzi
   plausibili. Sostituiscili con le birre che compri davvero.

   id        codice univoco, non cambiarlo dopo il primo ordine
   prezzo    prezzo al pubblico, IVA inclusa, per singola bottiglia
   cartone   quante bottiglie compongono una cassa
   scorta    pezzi disponibili (0 = esaurito, non vendibile)
   colore    colore dell'etichetta disegnata sul sito
   ============================================================ */

const CATALOGO = [
  { id:"chiara-valdimonte", nome:"Chiara di Valle", birrificio:"Birrificio Valdimonte",
    stile:"Pils", regione:"Piemonte", abv:4.9, ibu:28, formato:33, prezzo:3.20,
    cartone:12, scorta:180, colore:"#f0c33c", tag:["bestseller"],
    descrizione:"Pilsner a bassa fermentazione, luppolatura tedesca e chiusura secca. La birra da tavola che non stanca mai.",
    abbinamento:"Fritture, pizza margherita, salumi dolci.",
    ingredienti:"Acqua, malto d'orzo, luppolo, lievito. Contiene glutine." },

  { id:"rosa-dei-venti", nome:"Rosa dei Venti", birrificio:"Officina Brassicola Adria",
    stile:"APA", regione:"Veneto", abv:5.4, ibu:42, formato:33, prezzo:3.90,
    cartone:12, scorta:144, colore:"#e08a2e", tag:["novita"],
    descrizione:"American Pale Ale dorata, agrumata, con un finale amaro pulito e beverino.",
    abbinamento:"Hamburger, formaggi di media stagionatura.",
    ingredienti:"Acqua, malto d'orzo, luppolo, lievito. Contiene glutine." },

  { id:"solenne-ipa", nome:"Solenne", birrificio:"Birrificio Valdimonte",
    stile:"IPA", regione:"Piemonte", abv:6.2, ibu:58, formato:33, prezzo:4.20,
    cartone:12, scorta:120, colore:"#c9701f", tag:["bestseller"],
    descrizione:"IPA ramata dal profilo resinoso: pompelmo, pino e un amaro lungo e ordinato.",
    abbinamento:"Carni speziate, curry, formaggi erborinati.",
    ingredienti:"Acqua, malto d'orzo, luppolo, lievito. Contiene glutine." },

  { id:"nebbia-bassa", nome:"Nebbia Bassa", birrificio:"Cascina Luppoli",
    stile:"NEIPA", regione:"Lombardia", abv:6.5, ibu:35, formato:33, prezzo:4.80,
    cartone:12, scorta:96, colore:"#e8b45a", tag:["novita"],
    descrizione:"New England IPA torbida e vellutata: mango, ananas e frutto della passione, amaro quasi assente.",
    abbinamento:"Cucina asiatica, formaggi freschi, da sola.",
    ingredienti:"Acqua, malto d'orzo, frumento, avena, luppolo, lievito. Contiene glutine." },

  { id:"grano-antico", nome:"Grano Antico", birrificio:"Birra di Corte",
    stile:"Weiss", regione:"Trentino", abv:5.0, ibu:12, formato:50, prezzo:4.60,
    cartone:12, scorta:110, colore:"#f2d98b", tag:[],
    descrizione:"Weizen bavarese fatta in Italia: banana, chiodi di garofano, schiuma cremosa e infinita.",
    abbinamento:"Wurstel, insalate, torte salate.",
    ingredienti:"Acqua, malto di frumento, malto d'orzo, luppolo, lievito. Contiene glutine." },

  { id:"notturna-stout", nome:"Notturna", birrificio:"Malteria del Borgo Nuovo",
    stile:"Stout", regione:"Emilia-Romagna", abv:6.8, ibu:45, formato:33, prezzo:4.50,
    cartone:12, scorta:88, colore:"#3b2413", tag:[],
    descrizione:"Stout nerissima con caffe' tostato, cacao amaro e una punta di liquirizia.",
    abbinamento:"Dolci al cioccolato, brasati, ostriche.",
    ingredienti:"Acqua, malto d'orzo, orzo tostato, avena, luppolo, lievito. Contiene glutine." },

  { id:"marea-gose", nome:"Marea", birrificio:"Salmastra Brewing",
    stile:"Sour", regione:"Puglia", abv:4.2, ibu:8, formato:33, prezzo:4.40,
    cartone:12, scorta:72, colore:"#d9e6d0", tag:[],
    descrizione:"Gose acidula con sale marino di Margherita di Savoia e scorza di limone. Dissetante come poche.",
    abbinamento:"Crudi di pesce, frutti di mare, aperitivo.",
    ingredienti:"Acqua, malto d'orzo, frumento, sale, coriandolo, luppolo, lievito. Contiene glutine." },

  { id:"fiore-luppolo", nome:"Fiore di Luppolo", birrificio:"Cascina Luppoli",
    stile:"Session IPA", regione:"Lombardia", abv:3.8, ibu:33, formato:33, prezzo:3.60,
    cartone:12, scorta:160, colore:"#e5c65e", tag:[],
    descrizione:"Poco alcol, tanto profumo: agrumi e fiori su un corpo leggerissimo. La IPA da due bicchieri.",
    abbinamento:"Aperitivo, pesce fritto, piatti leggeri.",
    ingredienti:"Acqua, malto d'orzo, luppolo, lievito. Contiene glutine." },

  { id:"ambra-di-langa", nome:"Ambra di Langa", birrificio:"Birrificio Valdimonte",
    stile:"Ambrata", regione:"Piemonte", abv:5.8, ibu:26, formato:33, prezzo:3.80,
    cartone:12, scorta:130, colore:"#b06423", tag:[],
    descrizione:"Ambrata maltata su note di caramello, nocciola e crosta di pane. Equilibrio piemontese.",
    abbinamento:"Agnolotti, arrosti, tome di montagna.",
    ingredienti:"Acqua, malto d'orzo, luppolo, lievito. Contiene glutine." },

  { id:"cerasa-sour", nome:"Cerasa", birrificio:"Malteria del Borgo Nuovo",
    stile:"Sour", regione:"Emilia-Romagna", abv:5.2, ibu:10, formato:33, prezzo:5.40,
    cartone:12, scorta:60, colore:"#a52c4a", tag:["novita"],
    descrizione:"Acida rifermentata con ciliegie di Vignola: rossa, vinosa, elegantemente aspra.",
    abbinamento:"Selvaggina, dolci alla frutta, formaggi caprini.",
    ingredienti:"Acqua, malto d'orzo, frumento, ciliegie, luppolo, lievito. Contiene glutine." },

  { id:"trebbia-blonde", nome:"Trebbia", birrificio:"Birra di Corte",
    stile:"Blonde", regione:"Trentino", abv:7.0, ibu:22, formato:75, prezzo:9.50,
    cartone:6, scorta:48, colore:"#efc25a", tag:["regalo"],
    descrizione:"Blonde d'ispirazione belga in bottiglia da 75: rifermentata, secca, con lievito speziato.",
    abbinamento:"Tutto pasto, pesce al forno, formaggi lavati.",
    ingredienti:"Acqua, malto d'orzo, zucchero candito, luppolo, lievito. Contiene glutine." },

  { id:"bruma-saison", nome:"Bruma", birrificio:"Officina Brassicola Adria",
    stile:"Saison", regione:"Veneto", abv:6.4, ibu:30, formato:75, prezzo:9.80,
    cartone:6, scorta:36, colore:"#e3b04b", tag:["regalo"],
    descrizione:"Saison di campagna: pepe bianco, agrumi e una carbonazione vivace che pulisce la bocca.",
    abbinamento:"Cucina di campagna, verdure grigliate, salumi.",
    ingredienti:"Acqua, malto d'orzo, farro, luppolo, spezie, lievito. Contiene glutine." },

  { id:"vecchia-cantina", nome:"Vecchia Cantina", birrificio:"Malteria del Borgo Nuovo",
    stile:"Barley Wine", regione:"Emilia-Romagna", abv:10.5, ibu:40, formato:33, prezzo:7.90,
    cartone:6, scorta:30, colore:"#6d2f10", tag:["regalo"],
    descrizione:"Barley wine maturato dodici mesi in botte di rovere: uvetta, rum, vaniglia. Da meditazione.",
    abbinamento:"Cioccolato fondente, formaggi stagionati, sigaro.",
    ingredienti:"Acqua, malto d'orzo, luppolo, lievito. Contiene glutine." },

  { id:"zero-assoluto", nome:"Zero Assoluto", birrificio:"Cascina Luppoli",
    stile:"Analcolica", regione:"Lombardia", abv:0.4, ibu:20, formato:33, prezzo:2.90,
    cartone:12, scorta:200, colore:"#cfe3ef", tag:[],
    descrizione:"Analcolica luppolata a freddo: profuma di IPA, si beve a pranzo e prima di guidare.",
    abbinamento:"Pranzo di lavoro, sport, chi guida.",
    ingredienti:"Acqua, malto d'orzo, luppolo, lievito. Contiene glutine." }
];

/* --- Esportazione: stesso file usato dal browser e da Node --- */
if (typeof window !== "undefined") { window.CONFIG = CONFIG; window.CATALOGO = CATALOGO; }
if (typeof module !== "undefined" && module.exports) { module.exports = { CONFIG, CATALOGO }; }
