# ROADMAP — SuperLega v1

Per ogni milestone: pianifica → implementa → test verdi → revisione QA + security
→ commit (conventional commits) → riepilogo ≤ 8 righe (fatto / test / rischi /
prossimo passo). Le milestone si sviluppano in autonomia dopo il "vai" di Fase 1.

- **M1 — Fondamenta**: scaffold Next.js + TS strict + Tailwind + shadcn/ui, ESLint
  /Prettier, CI GitHub Actions (lint, typecheck, test, build), Supabase locale,
  auth email/password con verifica + codice lega, ruoli, layout responsive base,
  PWA di base (manifest, icone provvisorie, service worker app-shell).
- **M2 — Dati**: migrazioni complete (docs/DATA_MODEL.md), RLS, funzioni helper,
  seed di sviluppo (listone da fixture + 20 squadre), parser Excel quotazioni
  (test su fixture reale), import listone da admin con anteprima diff.
- **M3 — Rose**: import export "Rose" (matching per nome + report anomalie +
  conferma), assegnazione manuale admin, vista rosa manager (valore, crediti,
  composizione vs 3/7/7/6), rose altrui in sola lettura, listone/svincolati con
  ricerca istantanea e filtri.
- **M4 — Mercato**: sessioni (crea/programma/apri/chiudi, foto svincolati, +5
  crediti), `swap_player` e `free_swap_player`, flusso cambio in due tocchi con
  conferma, registro operazioni + bacheca, annullamento admin, validazione alla
  chiusura, test di concorrenza su crediti/limiti.
- **M5 — Sync quotazioni**: verifica fattibilità download automatico da
  Fantacalcio.it (robots.txt, login, ToS) e decisione documentata; sorgente
  pluggable + cron 06:00 + keep-alive; storico quotazioni con grafico; gestione
  fuori lista da foglio Ceduti con notifica admin.
- **M6 — Admin ed email**: pannello admin completo (utenti, squadre, impostazioni,
  log, audit), export Excel (rose, listone, operazioni), email apertura/chiusura
  sessione via Resend.
- **M7 — Design pass**: design system completo (docs/DESIGN.md), logo e icone
  definitive, card giocatore, micro-animazioni, stati vuoti, skeleton, tema
  chiaro, accessibilità AA, PWA finale, Lighthouse mobile ≥ 90.
- **M8 — Hardening e consegna**: e2e Playwright desktop+mobile, security review
  (OWASP, RLS, rate limiting), prestazioni, backup/export DB, documentazione
  (README, DEPLOY, MANUALE_ADMIN, MANUALE_MANAGER).

**Fase 3 — Deploy**: creazione guidata account Vercel/Supabase/Resend, env di
produzione, migrazioni, cron, smoke test in produzione, checklist di primo avvio
(import listone reale, squadre, rose, sessione di prova con la lega).
