-- MML from the "Sotuv uchun" spreadsheet, replacing the rule + override model.
--
-- The sheet's "MML" tab has one row per book and one column per kind of store;
-- a cell is a WEIGHT:
--   1            that title, by name
--   0,5 0,3 0,2  that share of the book's category, without naming titles
--   0            not expected
-- The column's fractional weights of one category add up to a target number of
-- titles from that category (0,3 x 25 C books = 7,5), ROUNDED UP (decided
-- 2026-09-15). MML caps each category at its target, so it never passes 100%.
--
-- Which column a store is measured against (decided by the team):
--   grade A++, any type      -> every title in the sheet, by name
--   Kitob do'kon, A+ or A    -> "Kitob do'kon (A)"
--   Kitob do'kon, B          -> "Kitob do'kon (B)"
--   Kitob do'kon, C or none  -> "Kitob do'kon (C)"
--   any other store type     -> the column named after the type
--
-- The per-store exceptions (mml_overrides) and the category rules (mml_rules)
-- are dropped: the sheet is the only source of the must-list. store_stock,
-- the hand-set "is it on the shelf", stays.
--
-- Everything is computed in numeric, not in the application: in floating point
-- 0,2 x 25 is 5.000000000000001 and rounds up to 6.

-- 1. alternate spellings: the sheet's title for a book the platform already has
create table if not exists book_aliases (
  alias   text primary key,
  book_id bigint not null references books(id) on delete cascade
);
alter table book_aliases enable row level security;
alter table book_aliases force  row level security;
drop policy if exists ba_read on book_aliases;
create policy ba_read on book_aliases for select using (current_user_id() is not null);
drop policy if exists ba_write on book_aliases;
create policy ba_write on book_aliases for all
  using (can_manage_users()) with check (can_manage_users());
grant select, insert, update, delete on book_aliases to falaq_app;

insert into book_aliases (alias, book_id)
select a.alias, b.id
  from (values
    ('Alloh sari yigirma bekat', 'Alloh sari 20 bekat'),
    ('Rasululloh sallallohu alayhi vasallamdan maktublar', 'Rasulullohdan maktublar'),
    ('Kechir Allohim', 'Кечир Аллохим')
  ) a(alias, title)
  join books b on b.title = a.title
on conflict (alias) do update set book_id = excluded.book_id;

-- 2. the weights, exactly as the sheet has them
create table if not exists mml_weights (
  mml_column text    not null,   -- the MML tab's header, e.g. "Kitob do'kon (B)"
  book_id    bigint  not null references books(id) on delete cascade,
  weight     numeric(4,3) not null check (weight >= 0 and weight <= 1),
  primary key (mml_column, book_id)
);
create index if not exists mml_weights_book_idx on mml_weights(book_id);
alter table mml_weights enable row level security;
alter table mml_weights force  row level security;
drop policy if exists mw_read on mml_weights;
create policy mw_read on mml_weights for select using (current_user_id() is not null);
drop policy if exists mw_write on mml_weights;
create policy mw_write on mml_weights for all
  using (can_manage_users()) with check (can_manage_users());
grant select, insert, update, delete on mml_weights to falaq_app;

-- 3. the old model goes
drop view if exists v_mml;
drop view if exists v_mml_share;
drop view if exists v_mml_status;
drop view if exists v_mml_book;
drop view if exists v_mml_pool_target;
drop view if exists v_store_mml_column;
drop view if exists v_store_mml;
drop table if exists mml_overrides;
drop table if exists mml_rules;

comment on column stores.category is
  'Historical: the old per-sheet MML label. MML now uses store_type + grade (db/21).';

-- 4. the column each active store is measured against
create view v_store_mml_column with (security_invoker = true) as
select s.id as store_id, s.code, s.name as store_name, s.store_type, s.grade,
       case
         when s.grade = 'A++'                then 'Barcha kitoblar (A++)'
         when s.store_type = 'Kitob do''kon' then 'Kitob do''kon (' ||
              case when s.grade in ('A+', 'A') then 'A'
                   when s.grade = 'B'          then 'B'
                   else 'C' end || ')'
         else s.store_type
       end as mml_column
  from stores s
 where s.active;

-- 5. per column and category: how many titles its fractional weights add up to
create view v_mml_pool_target with (security_invoker = true) as
select w.mml_column, b.category as book_category,
       ceil(sum(w.weight))::int as target,
       count(*)                 as titles
  from mml_weights w
  join books b on b.id = w.book_id
 where b.active and b.category is not null and w.weight > 0 and w.weight < 1
 group by 1, 2;

-- 6. every book that counts for a store: 'nomma' = required by name,
--    'ulush' = counts toward its category's share
create view v_mml_book with (security_invoker = true) as
select c.store_id, c.code, c.store_name, c.mml_column,
       b.id as book_id, b.title, b.category as book_category, 'nomma'::text as kind
  from v_store_mml_column c
  join books b on b.active and b.category is not null
 where c.mml_column = 'Barcha kitoblar (A++)'
union all
select c.store_id, c.code, c.store_name, c.mml_column,
       b.id, b.title, b.category, 'nomma'
  from v_store_mml_column c
  join mml_weights w on w.mml_column = c.mml_column and w.weight = 1
  join books b on b.id = w.book_id and b.active
union all
-- any title of a share category counts, including ones only the Kitoblar tab
-- lists; a title weighted 1 or 0 in this column is not part of the share
select c.store_id, c.code, c.store_name, c.mml_column,
       b.id, b.title, b.category, 'ulush'
  from v_store_mml_column c
  join v_mml_pool_target t on t.mml_column = c.mml_column
  join books b on b.active and b.category = t.book_category
  left join mml_weights w on w.mml_column = c.mml_column and w.book_id = b.id
 where w.book_id is null or (w.weight > 0 and w.weight < 1);

-- 7. what is on the shelf: a hand-set value, else the last visit
create view v_mml_status with (security_invoker = true) as
select m.store_id, m.code, m.store_name, m.mml_column,
       m.book_id, m.title, m.book_category, m.kind,
       lv.visited_at                                as oxirgi_vizit,
       coalesce(ss.present, vb.book_id is not null) as bor,
       (ss.store_id is not null)                    as qolda
  from v_mml_book m
  left join v_store_last_visit lv on lv.store_id = m.store_id
  left join visit_books vb
         on vb.visit_id = lv.visit_id and vb.book_id = m.book_id and vb.status = 'present'
  left join store_stock ss on ss.store_id = m.store_id and ss.book_id = m.book_id;

-- 8. per store, per share category: target, found, and what counts (capped)
create view v_mml_share with (security_invoker = true) as
select st.store_id, st.book_category, t.target,
       count(*) filter (where st.bor)                  as bor,
       least(count(*) filter (where st.bor), t.target) as hisob
  from v_mml_status st
  join v_mml_pool_target t on t.mml_column = st.mml_column and t.book_category = st.book_category
 where st.kind = 'ulush'
 group by st.store_id, st.book_category, t.target;

-- 9. MML per store. A store with neither a visit nor a hand-set value scores
--    null: no evidence is not the same fact as "we looked and found nothing".
create view v_mml with (security_invoker = true) as
with named as (
  select store_id, count(*) as kerak, count(*) filter (where bor) as bor
    from v_mml_status where kind = 'nomma' group by store_id
), shares as (
  select store_id, sum(target) as kerak, sum(hisob) as bor
    from v_mml_share group by store_id
), seen as (
  select store_id, max(oxirgi_vizit) as oxirgi_vizit, bool_or(qolda) as qolda_bor
    from v_mml_status group by store_id
), totals as (
  select c.store_id, c.code, c.store_name, c.mml_column,
         coalesce(n.kerak, 0) + coalesce(sh.kerak, 0) as kerak,
         coalesce(n.bor, 0)   + coalesce(sh.bor, 0)   as bor,
         seen.oxirgi_vizit, coalesce(seen.qolda_bor, false) as qolda_bor
    from v_store_mml_column c
    left join named  n    on n.store_id = c.store_id
    left join shares sh   on sh.store_id = c.store_id
    left join seen        on seen.store_id = c.store_id
)
select store_id, code, store_name, mml_column as store_category,
       oxirgi_vizit, qolda_bor,
       kerak::int, bor::int, (kerak - bor)::int as yetishmaydi,
       case when oxirgi_vizit is null and not qolda_bor then null
            else round(100.0 * bor / kerak, 1)
       end as mml
  from totals
 where kerak > 0;

grant select on v_store_mml_column, v_mml_pool_target, v_mml_book, v_mml_status,
                v_mml_share, v_mml to falaq_app;
