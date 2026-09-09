---
name: release-checklist
description: Definition of done per milestone and per deploy for SuperLega. Load at the end of every milestone and before any production deploy.
---

# Release checklist

## Fine milestone (tutte obbligatorie)

- [ ] `npm run lint` + `npm run typecheck` + `npm run test` verdi in locale e CI
- [ ] e2e toccati dalla milestone verdi (desktop + viewport 375px)
- [ ] regole di dominio nuove coperte da test a livello funzione/DB
- [ ] provato a mano da viewport mobile: niente zoom né scroll orizzontale
- [ ] review `qa-tester` e `security-reviewer` passate (critici = blocco)
- [ ] `docs/DECISIONS.md` aggiornato; SPEC intatta (o ok admin ottenuto)
- [ ] nessun secret/credenziale nel diff (`git diff` riletto)
- [ ] conventional commit; riepilogo ≤ 8 righe all'admin

## Pre-deploy produzione (Fase 3)

- [ ] migrazioni applicate su Supabase prod senza errori
- [ ] env Vercel completi (`.env.example` come riferimento), CRON_SECRET setato
- [ ] cron schedulato e testato una volta a mano; log visibile in-app
- [ ] RLS verificata in prod (query come anon → negata)
- [ ] rate limiting attivo su login e operazioni
- [ ] Lighthouse mobile ≥ 90 (Performance, Best Practices, Accessibility)
- [ ] PWA installabile da iPhone e Android (manifest, icone, SW)
- [ ] smoke test prod: registrazione con codice lega, login, rosa visibile,
      import listone con anteprima, apertura+cambio+chiusura sessione di prova
- [ ] backup/export DB documentato e provato una volta
- [ ] credenziali primo admin consegnate fuori dal repo

## Definition of done v1 (da docs/SPEC.md §10)

Tutto quanto sopra più: sync automatico eseguito almeno una volta in produzione
con log; test di concorrenza verdi (crediti/limiti sotto operazioni simultanee);
documentazione consegnata; checklist primo avvio eseguita con l'admin.
