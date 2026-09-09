# Test SQL (migrazioni, funzioni, RLS)

Girano su un PostgreSQL locale con `tests/db/auth-stub.sql` al posto dello schema
`auth` di Supabase (Docker non è disponibile nell'ambiente di sviluppo remoto).

```bash
scripts/db-test.sh
```

Ogni `*.test.sql` gira in una transazione con rollback e fallisce sollevando
un'eccezione. Helper: `auth.test_login(user_id, ruolo)` e `auth.test_logout()`
impersonano un utente come farebbe PostgREST (`request.jwt.claim.sub` + `set role`).

Con Supabase CLI disponibile, `supabase db reset` + `supabase test db` restano
la strada ufficiale; questi file sono compatibili (nessuna dipendenza dallo stub
oltre alle funzioni `auth.test_*`).
