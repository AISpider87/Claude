-- SuperLega — pianificazione del feed indisponibili/formazioni (ogni 15 minuti).
--
-- Perché serve: il piano Hobby di Vercel consente UN SOLO cron al giorno, che
-- usiamo già per le quotazioni. Le formazioni ufficiali escono circa un'ora
-- prima del calcio d'inizio, quindi il feed va chiamato molto più spesso: lo
-- fa Supabase con pg_cron + pg_net.
--
-- NON è ancora attivo: l'admin deve eseguire QUESTO FILE UNA VOLTA, a mano,
-- dopo aver sostituito i due segnaposto qui sotto.
--
-- COME FARE
-- 1. Apri il progetto su supabase.com → SQL Editor → New query.
-- 2. Incolla tutto questo file.
-- 3. Sostituisci i DUE segnaposto:
--      <SITO>        → l'URL pubblico dell'app, senza barra finale,
--                      es. https://superlega.vercel.app
--      <CRON_SECRET> → lo stesso valore della variabile CRON_SECRET
--                      impostata su Vercel (Settings → Environment Variables).
--    Il segreto resta dentro il database: non finisce nel repository.
-- 4. Premi Run. Da quel momento il job parte ogni 15 minuti.
-- 5. Verifica in Admin → Indisponibili che "Ultimo aggiornamento" si muova, e
--    controlla lo storico con l'ultima query in fondo a questo file.
--
-- Costo: 0 €. Consumo: 4 esecuzioni l'ora × al massimo 3 richieste API =
-- fino a 288 richieste al giorno in teoria, MA le richieste sono 2 quando non
-- c'è una partita imminente (la chiamata formazioni viene saltata) e il piano
-- gratuito di API-Football ne concede 100 al giorno. Vedi docs/SYNC.md: se la
-- quota si esaurisce, alza l'intervallo a '*/30 * * * *' o limita il job alle
-- ore delle partite (esempio in fondo).

-- 1) Estensioni (idempotenti: se ci sono già, non succede nulla).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Il job. `cron.schedule` con lo stesso nome sovrascrive il precedente.
select cron.schedule(
  'superlega-availability',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := '<SITO>/api/cron/sync-availability',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    timeout_milliseconds := 55000
  );
  $$
);

-- 3) Controlli utili -------------------------------------------------------
-- Job pianificati:
--   select jobid, jobname, schedule, active from cron.job;
-- Ultime esecuzioni (status 'succeeded' = la chiamata HTTP è partita):
--   select jobname, status, return_message, start_time
--   from cron.job_run_details order by start_time desc limit 20;
-- Risposte HTTP ricevute da pg_net (200 = tutto bene, 401 = CRON_SECRET errato):
--   select id, status_code, content from net._http_response order by id desc limit 10;
-- Stato del feed come lo vede l'app:
--   select key, value from public.league_settings
--   where key in ('availability_synced_at', 'availability_last_run');

-- 4) Per annullare tutto (il feed torna a dipendere solo dalle visite all'app):
--   select cron.unschedule('superlega-availability');

-- 5) Variante a consumo ridotto: solo nelle fasce delle partite di Serie A
--    (sabato/domenica 11:00-22:00 UTC e lunedì/venerdì 17:00-21:00 UTC).
--    Sostituisce il job precedente, stesso nome:
--   select cron.schedule('superlega-availability', '*/15 11-22 * * 0,6', $$ ... $$);
