-- The first administrator, and nobody else.
--
-- There used to be a placeholder org chart here (Jasur, Dilshod, Nodira and
-- four managers on fake 9000000xx telegram ids). It was removed on
-- 2026-09-11: a fresh install must not invent people. Everyone else is created
-- by an administrator on /admin/users, which is now the only way an account
-- comes into existence.
--
-- This row deliberately has NO password. A password written into a file in the
-- repository is a password everybody has, so the first one is set once, by
-- hand, on the machine that runs the database:
--
--   npx tsx scripts/set-password.mjs komil '<parol>'
--
-- After that Komil signs in at /login and creates everybody else.
--
-- FOR A DIFFERENT DEPLOYMENT: change the login and name below to the person
-- who should hold the first direktor account.
--
-- Run as a superuser / a role with BYPASSRLS (force RLS applies to the owner).

-- Guarded by "no direktor yet" rather than by ON CONFLICT on the login,
-- because db:load replays this file against databases that predate logins:
-- the Komil already in there has a NULL username, no conflict target would
-- match it, and a plain insert would quietly create a second Komil. Give the
-- existing one a login with the same script instead:
--
--   npx tsx scripts/set-password.mjs komil '<parol>' Komil

insert into users (username, full_name, role, parent_id, active)
select 'komil', 'Komil', 'direktor', null, true
 where not exists (select 1 from users where role = 'direktor')
on conflict (lower(username)) do nothing;
