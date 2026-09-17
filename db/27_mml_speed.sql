-- MML was taking 3.5 seconds, and giving different answers to different people.
-- Both had the same cause.
--
-- v_mml_status is security_invoker, so every row of visit_books was checked
-- against policy vb_all — `visit_id in (select id from visits)` — a subquery
-- over a table that is itself RLS'd by my_team(). Over 27 000 rows that cost
-- 963ms per evaluation of v_mml, and /api/mml evaluates it three times.
--
-- The second problem is worse than the speed. visits.v_read scopes to
-- my_team(), so a manager looking at a shop whose last visit was filed by
-- somebody outside their team saw the shelf as EMPTY: the books were there,
-- the visit that found them was simply invisible to them. MML read as 0%.
--
-- What is on a shop's shelf is a fact about the shop, not about who is asking
-- — the same reasoning db/19 used to make plan_visit_between SECURITY DEFINER.
--
-- So exactly the two VISIT lookups stop being filtered, and nothing else. They
-- are plain views: owned by falaq_owner and left security_invoker=false, so
-- they run with the owner's BYPASSRLS. Two earlier attempts are worth not
-- repeating — SECURITY DEFINER set-returning functions joined into the view
-- were SLOWER (2.7s), because the planner has no row estimate for a function
-- and re-evaluates it per row; and `create or replace view` without an
-- explicit WITH silently drops security_invoker, which widens every other
-- table the view touches. Hence the explicit option on v_mml_status below.

/** Each store's most recent visit, whoever filed it. Deliberately unfiltered. */
create or replace view v_mml_last_visit
with (security_invoker = false) as
select distinct on (v.store_id) v.store_id, v.id as visit_id, v.visited_at
  from visits v
 order by v.store_id, v.visited_at desc;

/** Titles found on the shelf at that visit. Deliberately unfiltered. */
create or replace view v_mml_shelf
with (security_invoker = false) as
select lv.store_id, vb.book_id
  from v_mml_last_visit lv
  join visit_books vb on vb.visit_id = lv.visit_id and vb.status = 'present';

grant select on v_mml_last_visit, v_mml_shelf to falaq_app;

-- unchanged columns and types, so every view built on top keeps working; the
-- shop/book/weight tables are still read as the person asking
create or replace view v_mml_status
with (security_invoker = true) as
select m.store_id, m.code, m.store_name, m.mml_column,
       m.book_id, m.title, m.book_category, m.kind,
       lv.visited_at as oxirgi_vizit,
       coalesce(ss.present, sh.book_id is not null) as bor,
       ss.store_id is not null as qolda
  from v_mml_book m
  left join v_mml_last_visit lv on lv.store_id = m.store_id
  left join v_mml_shelf      sh on sh.store_id = m.store_id and sh.book_id = m.book_id
  left join store_stock      ss on ss.store_id = m.store_id and ss.book_id = m.book_id;

grant select on v_mml_status to falaq_app;

drop function if exists mml_last_visits();
drop function if exists mml_last_visit_books();
