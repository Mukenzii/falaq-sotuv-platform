-- ############################################################################
-- ##  DEVELOPMENT ONLY — NEVER RUN THIS AGAINST PRODUCTION.                 ##
-- ##  PRODUCTIONDA ISHLATMANG. It inserts invented visits.                  ##
-- ##  Nothing loads it automatically: it lives in scripts/, not db/.        ##
-- ############################################################################
-- FAKE DATA for looking at MML. Not for the real database once you are live.
--
--   docker compose exec -T db psql -U falaq_owner -d falaq < scripts/demo-mml.sql
--   docker compose exec -T db psql -U falaq_owner -d falaq < scripts/demo-mml-clear.sql
--
-- It pauses the Google Sheets push on the way in, because these visits must
-- never reach the real company spreadsheet. The clear script turns it back on.
--
-- Everything is derived from md5(store, book) rather than random(), for two
-- reasons: the numbers are the same every run, so a figure on screen can be
-- checked by hand; and Postgres hoists an uncorrelated random() out of a
-- LATERAL, which silently gives every store identical data.

begin;

update sheets_sync set paused = true where id;

delete from visit_books where visit_id in (select id from visits where note like '[DEMO]%');
delete from visit_answers where visit_id in (select id from visits where note like '[DEMO]%');
delete from visits where note like '[DEMO]%';

-- A manager to own the visits. It must be someone the direktor can actually
-- SEE: RLS scopes visits to descendants(), so a manager with no parent_id is
-- invisible to everyone including the direktor, and the demo would look empty
-- while the rows sat in the table. Prefer a manager inside the direktor's
-- tree; fall back to the direktor.
create temporary table demo_manager as
select coalesce(
  (select u.id from users u
     join descendants((select id from users where role = 'direktor' and active
                        order by created_at limit 1)) d on d.id = u.id
    where u.role = 'sotuv_manager' and u.active order by u.created_at limit 1),
  (select id from users where role = 'direktor' and active order by created_at limit 1)) as id;

-- Two thirds of the categorised stores get visited; the rest stay unvisited so
-- the "borilmagan" case is visible too.
create temporary table demo_store as
select s.id,
       -- a stable 0-99 per store
       abs(('x' || substr(md5('v' || s.id::text), 1, 8))::bit(32)::int % 100) as roll
  from stores s
 where s.active and s.category is not null;

-- CREATE TABLE AS cannot take a bare INSERT, but it can select from a
-- data-modifying CTE, which is how the new ids come back out.
create temporary table demo_visit as
with ins as (
  -- took_order and area_m2 are generated columns; visit_result drives the first
  insert into visits (manager_id, store_id, visited_at, note, width_m, height_m, facing, visit_result)
  select m.id, d.id,
         now() - make_interval(days => (d.roll % 27) + 1),
         '[DEMO] namuna vizit',
         1.0 + (d.roll % 20) / 10.0,
         1.5 + (d.roll % 15) / 10.0,
         (array['face','qisman_face','koreshok']::visit_facing[])[1 + (d.roll % 3)],
         case when (d.roll % 3) <> 0 then array['Buyurtma oldim'] else array['Buyurtma yo''q'] end
    from demo_store d, demo_manager m
   where d.roll < 66
  returning id, store_id
)
select id, store_id from ins;

-- Each store is given a target compliance between 35% and 100%, and a title
-- counts as on the shelf when its own hash falls under that target. Same pair,
-- same answer, every time.
insert into visit_books (visit_id, book_id, status)
select v.id, m.book_id, 'present'::book_status
  from demo_visit v
  join v_mml_book m on m.store_id = v.store_id   -- every title that counts for the store
 where abs(('x' || substr(md5(v.store_id::text || ':' || m.book_id::text), 1, 8))::bit(32)::int % 100)
       < 35 + abs(('x' || substr(md5('t' || v.store_id::text), 1, 8))::bit(32)::int % 66)
on conflict do nothing;

-- A few titles that are on the shelf but going stale, so the other half of the
-- visit form has something in it too.
insert into visit_books (visit_id, book_id, status)
select v.id, m.book_id, 'stale'::book_status
  from demo_visit v
  join v_mml_book m on m.store_id = v.store_id   -- every title that counts for the store
 where abs(('x' || substr(md5('s' || v.store_id::text || ':' || m.book_id::text), 1, 8))::bit(32)::int % 100) < 8
   and not exists (select 1 from visit_books vb where vb.visit_id = v.id and vb.book_id = m.book_id)
on conflict do nothing;

commit;

select count(*) || ' demo visits' from visits where note like '[DEMO]%';
select round(avg(mml), 1) || '% average MML across ' || count(*) || ' visited stores'
  from v_mml where mml is not null;
\echo '*** Google Sheets push is PAUSED so this fake data cannot reach the real spreadsheet.'
\echo '*** Run scripts/demo-mml-clear.sql to remove it and resume.'
