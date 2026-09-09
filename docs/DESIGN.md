# DESIGN — SuperLega

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
(`#0284C7` per contrasto AA su chiaro).

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
