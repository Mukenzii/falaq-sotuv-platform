-- The first administrator, and nobody else.
--
-- There used to be a placeholder org chart here (Jasur, Dilshod, Nodira and
-- four managers on fake 9000000xx telegram ids). It was removed on
-- 2026-09-11: a fresh install must not invent people. Everyone else joins the
-- real way — they press START in the bot, a join request appears, and an
-- admin approves them on /admin/sozlash. No telegram id is ever typed by hand.
--
-- FOR A DIFFERENT DEPLOYMENT: change the telegram id and name below to the
-- person who should hold the first direktor account. Their Telegram id is
-- whatever @falaqreaderbot sees when they message it; everything else follows
-- from the admin panel.
--
-- Run as a superuser / a role with BYPASSRLS (force RLS applies to the owner).

insert into users (telegram_id, full_name, role, parent_id, active) values
  (6604196370, 'Komil', 'direktor', null, true)
on conflict (telegram_id) do update
  set full_name = excluded.full_name, role = 'direktor', active = true;
