-- Both admin roles see every member of staff, not only the direktor.
--
-- A sotuv_boshligi passes can_manage_users(): they create people, change their
-- role and region, and plan their week. But u_read let only the direktor see
-- everyone; a sotuv_boshligi saw their own branch of the org chart and no more.
-- So an agent added with someone else as boss, or with no boss yet, could be
-- given a whole week of shops and then vanish from the board of the admin who
-- planned it: v_week_plan joins users under the viewer's RLS, so their cards,
-- their row in Xodimlar and their name above the board all dropped out.
--
-- my_role() is what u_read already called per row, so this costs nothing new.
-- The rest is db/33's rule unchanged: your branch, and for a head, the managers
-- of their regions. Safe to re-run.

drop policy if exists u_read on users;
create policy u_read on users for select
  using (my_role() in ('direktor', 'sotuv_boshligi')
         or id in (select my_team())
         or id in (select my_region_workers()));
