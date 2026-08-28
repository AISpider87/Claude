/* ============================================================
   SERVER DEI PAGAMENTI — Luppolo Nostrano
   ------------------------------------------------------------
   Crea le sessioni di pagamento Stripe per il negozio.

   Regola d'oro: il prezzo NON arriva mai dal browser. Il sito
   manda solo gli id dei prodotti e le quantita'; il totale viene
   ricalcolato qui leggendo ../prodotti.js, che e' lo stesso
   listino mostrato ai clienti. Cosi' nessuno puo' pagare 1 euro
   modificando la pagina dal proprio computer.

   Avvio:  npm install && npm start
   ============================================================ */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { CONFIG, CATALOGO } = require("../prodotti.js");

const CHIAVE = process.env.STRIPE_CHIAVE_SEGRETA;
if (!CHIAVE) {
  console.error("\n[errore] Manca STRIPE_CHIAVE_SEGRETA.");
  console.error("         Copia .env.esempio in .env e inserisci la chiave di Stripe.\n");
  process.exit(1);
}
const stripe = require("stripe")(CHIAVE);

const PORTA = process.env.PORTA || 4242;
const SITO = process.env.SITO || "http://localhost:8000/index.html";
const ORIGINI = (process.env.ORIGINI_AMMESSE || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const CARTELLA_ORDINI = path.join(__dirname, "ordini");
const REGISTRO = path.join(CARTELLA_ORDINI, "ordini.jsonl");

const app = express();

/* Il webhook deve leggere il corpo grezzo: va registrato PRIMA di express.json */
app.post("/webhook", express.raw({ type: "application/json" }), webhook);

app.use(express.json({ limit: "64kb" }));
app.use(cors({
  origin(origine, ok) {
    // "null" = pagina aperta con doppio clic (file://), utile in prova
    if (!origine || origine === "null" || ORIGINI.includes(origine)) return ok(null, true);
    ok(new Error("Origine non ammessa: " + origine));
  }
}));

/* ---------- utilita' ---------- */
const centesimi = n => Math.round(n * 100);
const isola = prov => CONFIG.provinceIsole.includes(String(prov || "").toUpperCase());

function numeroOrdine() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `LN-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function registra(riga) {
  try {
    fs.mkdirSync(CARTELLA_ORDINI, { recursive: true });
    fs.appendFileSync(REGISTRO, JSON.stringify({ quando: new Date().toISOString(), ...riga }) + "\n");
  } catch (e) {
    console.error("[registro] impossibile scrivere l'ordine:", e.message);
  }
}

/* Ricalcola il carrello sui dati veri del listino. */
function calcola(articoli) {
  if (!Array.isArray(articoli) || !articoli.length) throw new Error("Carrello vuoto");
  if (articoli.length > 50) throw new Error("Troppe righe nel carrello");

  const righe = [];
  let merce = 0;

  for (const a of articoli) {
    const p = CATALOGO.find(x => x.id === a.id);
    if (!p) throw new Error("Prodotto inesistente: " + a.id);
    const q = Math.round(Number(a.qta));
    if (!Number.isFinite(q) || q < 1) throw new Error("Quantita' non valida per " + p.nome);
    if (q > p.scorta) throw new Error(`Disponibilita' insufficiente per ${p.nome}: restano ${p.scorta} pezzi`);

    const cassa = p.cartone > 0 && q >= p.cartone;
    const unitario = cassa ? p.prezzo * (1 - CONFIG.scontoCassa / 100) : p.prezzo;
    merce += unitario * q;

    righe.push({
      quantity: q,
      price_data: {
        currency: (CONFIG.valuta || "EUR").toLowerCase(),
        unit_amount: centesimi(unitario),
        product_data: {
          name: `${p.nome} — ${p.birrificio}`,
          description: `${p.stile} · ${p.abv}% vol · ${p.formato} cl${cassa ? ` · cassa intera −${CONFIG.scontoCassa}%` : ""}`
        }
      }
    });
  }

  merce = Math.round(merce * 100) / 100;
  if (merce < CONFIG.ordineMinimo) throw new Error(`Ordine minimo ${CONFIG.ordineMinimo} euro`);
  return { righe, merce };
}

function spedizione(merce, provincia) {
  const costo = merce >= CONFIG.sogliaPortoFranco ? 0 : (isola(provincia) ? CONFIG.spedizioneIsole : CONFIG.spedizione);
  return [{
    shipping_rate_data: {
      type: "fixed_amount",
      fixed_amount: { amount: centesimi(costo), currency: (CONFIG.valuta || "EUR").toLowerCase() },
      display_name: costo === 0 ? "Spedizione gratuita" : (isola(provincia) ? "Corriere espresso (isole)" : "Corriere espresso"),
      delivery_estimate: {
        minimum: { unit: "business_day", value: 1 },
        maximum: { unit: "business_day", value: 3 }
      }
    }
  }];
}

/* Evita redirect verso siti altrui: accetta solo le origini dichiarate. */
function ritornoSicuro(url) {
  try {
    const u = new URL(url);
    const ammesse = [...ORIGINI, new URL(SITO).origin];
    if (ammesse.includes(u.origin)) return u.origin + u.pathname;
  } catch (e) { /* url assente o malformato */ }
  return SITO;
}

/* ---------- creazione del pagamento ---------- */
app.post("/crea-pagamento", async (req, res) => {
  try {
    const { articoli, cliente = {}, ritorno } = req.body || {};
    const { righe, merce } = calcola(articoli);
    const numero = numeroOrdine();
    const base = ritornoSicuro(ritorno);

    const sessione = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: righe,
      shipping_options: spedizione(merce, cliente.provincia),
      customer_email: cliente.email || undefined,
      client_reference_id: numero,
      locale: "it",
      billing_address_collection: "auto",
      phone_number_collection: { enabled: false },
      metadata: {
        ordine: numero,
        cliente: `${cliente.nome || ""} ${cliente.cognome || ""}`.trim(),
        telefono: cliente.telefono || "",
        indirizzo: `${cliente.via || ""}, ${cliente.cap || ""} ${cliente.comune || ""} (${cliente.provincia || ""})`,
        citofono: cliente.citofono || "",
        note: (cliente.note || "").slice(0, 400),
        maggiorenne: "dichiarato in fase d'ordine"
      },
      success_url: `${base}?pagamento=ok&ordine=${numero}`,
      cancel_url: `${base}?pagamento=annullato`
    });

    registra({ stato: "in attesa di pagamento", ordine: numero, merce, sessione: sessione.id, cliente });
    res.json({ url: sessione.url, ordine: numero });

  } catch (err) {
    console.error("[crea-pagamento]", err.message);
    res.status(400).json({ errore: err.message });
  }
});

/* ---------- webhook: conferma del pagamento ---------- */
function webhook(req, res) {
  const segreto = process.env.STRIPE_WEBHOOK_SEGRETO;
  let evento;
  try {
    evento = segreto
      ? stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], segreto)
      : JSON.parse(req.body);
  } catch (err) {
    console.error("[webhook] firma non valida:", err.message);
    return res.status(400).send("firma non valida");
  }

  if (evento.type === "checkout.session.completed") {
    const s = evento.data.object;
    const ordine = s.client_reference_id || s.metadata?.ordine;
    registra({
      stato: "pagato",
      ordine,
      totale: (s.amount_total || 0) / 100,
      email: s.customer_details?.email,
      spedizione: s.shipping_details || s.collected_information?.shipping_details || null,
      metadata: s.metadata || null
    });
    console.log(`\n>>> ORDINE PAGATO ${ordine} — ${(s.amount_total || 0) / 100} euro — ${s.customer_details?.email}`);
    console.log(">>> Prepara il pacco e scala le scorte in prodotti.js\n");
  }
  res.json({ ricevuto: true });
}

/* ---------- controllo di salute ---------- */
app.get("/salute", (_req, res) => res.json({
  ok: true,
  negozio: CONFIG.nome,
  prodotti: CATALOGO.length,
  modo: CHIAVE.startsWith("sk_live") ? "PRODUZIONE" : "prova"
}));

app.listen(PORTA, () => {
  console.log(`\n  ${CONFIG.nome} — server dei pagamenti`);
  console.log(`  in ascolto su http://localhost:${PORTA}`);
  console.log(`  modo: ${CHIAVE.startsWith("sk_live") ? "PRODUZIONE (soldi veri)" : "prova (carte di test)"}`);
  console.log(`  metti questo indirizzo in prodotti.js -> pagamenti.stripeEndpoint:`);
  console.log(`  http://localhost:${PORTA}/crea-pagamento\n`);
});
