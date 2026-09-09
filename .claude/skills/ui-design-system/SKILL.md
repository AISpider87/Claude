---
name: ui-design-system
description: SuperLega design tokens, base components, mobile patterns, and rules about logos and photos. Load when building or reviewing any UI.
---

# UI design system — SuperLega

Authority: `docs/DESIGN.md` (token, palette, tipografia). Qui: pattern operativi.

## Regole dure

- Palette SOLO da token (blu chiaro / blu scuro / nero + colori ruolo + danger).
  Nessun colore hardcoded fuori dai token Tailwind/CSS vars.
- Dark default, light selezionabile: ogni componente testato in entrambi.
- Cifre (crediti, quotazioni): `tabular-nums`, font display Space Grotesk.
- Colori ruolo P giallo / D verde / C blu / A rosso, SEMPRE con la lettera.
- VIETATO: loghi ufficiali di club/Serie A/Fantacalcio.it, foto di calciatori,
  imitazioni card EA FC/FUT, nomi/loghi di brand. Squadre = sigla 3 lettere +
  colori; giocatori = iniziali in esagono.
- Testi UI in italiano (tono asciutto, "tu"); aria-label incluse.

## Pattern mobile (target primario)

- Reference viewport 375px; breakpoint: colonna singola <768, tablet 768,
  desktop 1024 (admin sidebar).
- Bottom-nav manager: Rosa · Mercato · Listone · Profilo. Admin: sidebar.
- Safe-area iOS (`env(safe-area-inset-*)`), `100dvh` mai `100vh`, tap ≥ 44px,
  niente hover-only: ogni azione raggiungibile con tap.
- Liste lunghe (listone ~530): ricerca istantanea client-side su dataset
  precaricato, filtri come chip fissi in alto, virtualizzazione se serve.
- Conferme distruttive/di spesa: bottom sheet con saldo prima/dopo, mai
  window.confirm.

## Componenti base (shadcn/ui personalizzati)

Button, Input, Sheet/Drawer, Dialog, Toast, Tabs, Badge (ruolo, svincolato,
fuori lista), DataTable (admin), PlayerCard, CreditCounter (animato), Skeleton,
EmptyState (linee tattiche SVG), CountdownSessione.

## Accessibilità

AA in entrambi i temi; focus ring visibile (`--primary`); `prefers-reduced-
motion` → disattiva Framer Motion; ordine di tab logico; errori form annunciati.
