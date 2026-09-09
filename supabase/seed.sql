-- Local development seed. NEVER run in production.
-- Production bootstrap (league code + first admin) is documented in docs/DEPLOY.md.

insert into public.league_settings (key, value) values
  ('league_code', '"SUPERLEGA-DEV"'),
  ('bootstrap_admin_email', '"admin@superlega.local"')
on conflict (key) do update set value = excluded.value;
