# Sync automatico delle quotazioni

## Come funziona

- Job giornaliero: **Vercel Cron** chiama `GET /api/cron/sync-quotations` alle
  **04:30 UTC** (06:30 in ora legale, 05:30 in ora solare) con
  `Authorization: Bearer $CRON_SECRET`. Il piano Hobby consente una sola
  esecuzione al giorno per job, quindi l'orario non segue il DST: è sempre prima
  che qualcuno apra l'app.
- Il job usa la **chiave service-role** (solo lato server) e:
  1. fa una query minima (**keep-alive** del progetto Supabase Free, che altrimenti
     si mette in pausa dopo ~7 giorni di inattività);
  2. se `sync_enabled` è vero e una sorgente è configurata, scarica il file,
     lo analizza con lo **stesso parser** dell'upload manuale, salva un import
     `source = auto` con anteprima e lo applica;
  3. registra sempre l'esito in `imports` (anche i fallimenti), visibile in
     Admin → Listone.
- Sorgente = `QuotationSource` (pluggable). Implementazioni: `none` (default) e
  `http` (`QUOTATIONS_SOURCE_URL`, opzionale `QUOTATIONS_SOURCE_COOKIE`).
  Regole di cortesia: 1 richiesta al giorno, user-agent identificato
  (`SuperLega/1.0`), un solo secondo tentativo, timeout 20 s, massimo 5 MB,
  rifiuta risposte che non sono un `.xlsx` (es. pagina di login).

## Stato della verifica su Fantacalcio.it

Dall'ambiente di sviluppo il dominio `fantacalcio.it` **non è raggiungibile**
(proxy di rete), quindi URL di download, necessità di login, `robots.txt` e
termini d'uso **non sono ancora stati verificati**. Da fare in Fase 3, dal
computer dell'admin:

1. Aprire la pagina "Quotazioni Fantacalcio", scaricare l'Excel e annotare
   l'URL effettivo della richiesta (strumenti sviluppatore → Rete).
2. Controllare `https://www.fantacalcio.it/robots.txt` e i termini d'uso: se
   il download automatico non è consentito, **non configurare la sorgente** e
   restare sull'upload manuale (percorso garantito, stesso parser, anteprima).
3. Se consentito e l'URL funziona senza login: impostare `QUOTATIONS_SOURCE_URL`
   su Vercel. Se serve la sessione: `QUOTATIONS_SOURCE_COOKIE` (scade: da
   rinnovare) — oppure lasciare tutto manuale.
4. Premere **Esegui ora** in Admin → Listone per verificare, poi controllare
   il log degli import.

## Fallback garantito

L'upload manuale dell'admin (Admin → Listone → Nuovo import) resta sempre
disponibile e produce lo stesso risultato: anteprima delle differenze, poi
conferma. Se il sync automatico fallisce per più giorni, l'admin lo vede nel
pannello e può caricare il file a mano.
