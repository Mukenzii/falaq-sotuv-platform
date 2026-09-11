-- Runs inside the falaq database, which docker-compose already created.
--
-- The app connects as falaq_app, which owns nothing and is therefore subject
-- to RLS. Its password comes from APP_DB_PASSWORD in the environment: this
-- file used to hardcode a development password, which on a production volume
-- meant the database shipped with a password that is written down in the repo.
--
-- psql reads it straight out of the container environment, so the db service
-- must pass APP_DB_PASSWORD through. If it is absent we fall back to the
-- development password, which keeps `docker compose up` working locally and
-- is harmless there because the port is bound to the host only.
\getenv app_pw APP_DB_PASSWORD
\if :{?app_pw}
\else
  \set app_pw 'dev_only_change_me'
  \echo '!! APP_DB_PASSWORD is not set — falling back to the development password'
\endif

do $$ begin
  if not exists (select from pg_roles where rolname = 'falaq_app') then
    create role falaq_app login;
  end if;
end $$;

-- set every time, not only at creation, so rotating the secret is just a
-- matter of changing the env and re-running this file
alter role falaq_app login password :'app_pw';

-- Migrations and seeds must bypass RLS; force RLS applies to the owner too.
alter role falaq_owner bypassrls;

grant usage on schema public to falaq_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to falaq_app;
alter default privileges in schema public
  grant usage, select on sequences to falaq_app;
