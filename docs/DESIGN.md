# DESIGN — The SuperLeague

Direzione: **"calcio futuristico"** su palette vincolata **blu chiaro / blu scuro /
nero** (scelta dell'admin). Tema scuro di default, chiaro selezionabile. Design
originale: niente loghi ufficiali (club, Serie A, Fantacalcio.it), niente foto di
calciatori, niente imitazioni EA FC/FUT. Squadre = sigla + colori; giocatori =
iniziali/avatar generato.

## Token colore (dark, default)

| Token              | Valore                                                        | Uso                                                    |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------ |
| `--bg`             | `#05080F` (nero-blu)                                          | sfondo pagina, trama tattica sottile a bassa opacità   |
| `--surface`        | `#0B1220` (blu notte)                                         | card, pannelli                                         |
| `--surface-2`      | `#111B2E`                                                     | card elevate, header                                   |
| `--border`         | `#1E2A44`                                                     | bordi, divisori                                        |
| `--primary`        | `#38BDF8` (blu chiaro/ciano)                                  | azioni, link, focus ring, grafici                      |
| `--primary-strong` | `#0EA5E9`                                                     | pulsanti primari                                       |
| `--text`           | `#E6EDF7`                                                     | testo primario (AA su bg/surface)                      |
| `--text-muted`     | `#8CA0BF`                                                     | testo secondario                                       |
| `--danger`         | `#F87171`                                                     | unico colore di avviso (errori, crediti insufficienti) |
| `--success`        | derivato dal primary (niente verde dedicato: un solo accento) |

Tema chiaro: `--bg #F4F7FB`, `--surface #FFFFFF`, testo `#0B1220`, stesso primary
(`#0369A1` per contrasto AA su chiaro; danger `#B91C1C`; colori ruolo scuriti nel tema chiaro: P `#854D0E`, D `#065F46`, C `#0369A1`, A `#B91C1C`).

## Colori ruolo (coerenti in tutta l'app, dark e light)

P `#FACC15` giallo · D `#34D399` verde · C `#38BDF8` blu · A `#F87171` rosso —
sempre accompagnati dalla lettera del ruolo (mai solo colore).

## Tipografia

- Display/numeri: **Space Grotesk** (titoli, crediti, quotazioni — `font-variant-
numeric: tabular-nums` per tutte le cifre).
- Testo: **Inter**. Scala: 12/14/16/20/24/32. Line-height 1.5 nel testo, 1.2 nei
  display.

## Spaziature e layout

Scala 4px (4/8/12/16/24/32/48). Radius: 12px card, 8px controlli, pill per i
badge. Mobile-first: contenuto a colonna singola < 768px, bottom-nav per manager
(Rosa · Mercato · Listone · Profilo), sidebar per admin da ≥ 1024px.
iOS: safe-area insets, `100dvh`, tap target ≥ 44px, niente interazioni solo-hover.

## Componenti chiave

- **Card giocatore** (stile trading card sobrio): bordo/gradiente per ruolo,
  iniziali in un esagono, nome, squadra Serie A, Qt.A grande tabulare, badge
  "svincolato"/"fuori lista".
- **Dashboard manager**: crediti (contatore animato), valore rosa, countdown
  sessione, ultime operazioni.
- **Flusso cambio in 2 tocchi**: scegli chi esce → scegli lo svincolato → sheet di
  conferma con saldo prima/dopo; micro-animazione di conferma (Framer Motion).
- **Skeleton** su ogni lista in caricamento; **stati vuoti** illustrati con le
  linee tattiche; toast per esiti.

## Logo

Wordmark "SUPERLEGA" in Space Grotesk + emblema: scudo esagonale con "SL" e una
linea tattica diagonale, monocromo `--primary` su scuro. Da disegnare in M7 come
SVG originale (anche favicon/PWA icons 192/512 + maskable).

## Accessibilità

Contrasto AA in entrambi i temi (verificato in M7), focus visibile, `prefers-
reduced-motion` rispettato (animazioni disattivabili), etichette ARIA su filtri e
conferme.

## Stato dopo M7 (implementato)

- **Tema**: scuro di default, chiaro con il toggle in sidebar/header/profilo;
  scelta salvata per dispositivo (`localStorage`) e applicata da uno script
  inline prima del primo paint (nessun flash). `theme-color` segue il tema.
- **Logo**: emblema esagonale con corsa tattica diagonale e monogramma "SL"
  (`src/components/brand/logo.tsx`, `src/app/icon.svg`); icone PWA 192/512 +
  maskable + Apple touch generate da `scripts/make-icons.mjs` con Chromium.
- **Card giocatore** (`PlayerCard`): gradiente per ruolo, iniziali in esagono,
  Qt.A grande tabulare, badge svincolato/in rosa/fuori lista.
- **Flusso cambio**: filtro ruolo, lista che si richiude sulla scelta, motivo
  "crediti insufficienti" sui candidati non acquistabili, barra di conferma
  `sticky` sopra la bottom-nav su mobile, banner di successo animato.
- **Animazioni** (Framer Motion, disattivate con `prefers-reduced-motion`):
  contatore crediti, comparsa dei passi 2 e 3, check di conferma.
- **Skeleton** (`loading.tsx` per Rosa, Mercato, Listone, Squadre, Profilo,
  Admin) e **stati vuoti** con linee tattiche.
- **Accessibilità**: skip link "Vai al contenuto", `main#main`, tap target
  ≥ 44 px anche per i pulsanti `sm`, focus ring, `aria-pressed` sui filtri.
- **Lighthouse mobile** (pagine pubbliche, build di produzione, 2026-09-09):
  Performance 96–97 · Accessibility 100 · Best Practices 100 · SEO 91.
  Le pagine autenticate si misurano in produzione (Fase 3) con
  `scripts/lighthouse.sh`.

## Passata grafica 2026-09 (broadcast futuristico)

Direzione confermata dall'admin: "più futuristica, più motion, meno statica",
riquadri dei giocatori **più stretti e meglio organizzati**. Nessuna nuova
dipendenza, nessun colore fuori dai token.

- **Densità**: `RosterPlayerRow` 61 px a 375 px (prima 98, −38%): avatar 40 px,
  due righe di testo, `Qt.A` in una capsula tabulare, azioni a destra
  (icona sola sotto `sm`, con etichetta da `sm` in su; area di tocco 44 px).
  Lo stato "Disponibile" è un pallino con etichetta per screen reader; solo
  infortuni, dubbi, squalifiche e formazioni pubblicate meritano un chip
  (fonte e data nel `title`, link alla fonte sempre presente). Liste a
  2 colonne da `lg` e 3 da `2xl`; intestazione di ruolo sticky dentro la card.
- **Profondità e luce**: `.surface-lit` (bagliore radiale + bordo che si
  accende su hover/focus), `.edge-live` (bordo conico animato, sessione
  aperta), `.lit-dot`/`.lit-badge`, `.glow-primary` sui pulsanti, griglia
  tattica + diagonale + scanline sullo sfondo. Nel tema chiaro il bagliore
  diventa ombra (`--lift`, `--glow-primary`, `--grain-opacity`).
- **Motion** (tutto sotto `prefers-reduced-motion: no-preference`): entrata a
  cascata delle righe (CSS, 24 ms, max 280 ms), `layout` di Framer quando una
  riga cambia gruppo, transizione di pagina fra le tab, `scale(0.98)` alla
  pressione, contatori animati (crediti prima/dopo), sottolineatura scorrevole
  della tab attiva, header che si stacca allo scroll, countdown che "sfarfalla"
  sotto l'ora, check disegnato nella conferma, skeleton con shimmer.
- **Mercato come console**: rosa a sinistra, acquisto a destra da `lg`, con la
  striscia delle operazioni in sospeso fissata sopra le due colonne.
- **Intro dopo il login** (`src/components/motion/login-intro.tsx`): **4,2 s**,
  fondale renderizzato (`public/intro/backdrop.webp`, vortice generato con
  Higgsfield, 38 KB, solo tema scuro) che spinge lentamente in avanti,
  griglia in prospettiva che corre verso la camera → cometa che cresce venendoci
  incontro → impatto con onda d'urto e scintille → **stemma in 3D** (pila di
  facce in `preserve-3d`, quindi con spessore vero) che ruota, si posa e
  **resta**, pulsando con alone e anello a ogni battito fino alla tendina
  diagonale. Tempi in `intro-timing.tsx`. Una volta per accesso (`?welcome=1`
  consumato subito), saltabile con un tocco o un tasto, `aria-hidden`, ferma con
  `prefers-reduced-motion`. Accento caldo `--ember` usato solo qui. Si rivede
  quando si vuole da **Profilo → Rivedi l'animazione**.
