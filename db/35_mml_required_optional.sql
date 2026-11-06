-- MML matrix, November 2026: 1 = required, 2 = optional.
--
-- The commercial team rebuilt the "MML" tab of "Sotuv uchun": one row per BOOK
-- with its book category ("Kat.": A++, A+, A, B, C, New), one column per SHOP
-- category ("Kitob do'kon (A)", "Supermarket", …), and in each cell a
-- requirement code:
--   1   majburiy  — the shop must carry the title
--   2   ixtiyoriy — it may; it never lowers MML and is never listed as missing
--   0   what older sheets wrote where nothing was expected; read as not required
--
-- A code is a requirement, never a quantity. What is on the shelf is decided
-- exactly as before: a hand-set store_stock value if there is one, otherwise
-- the last visit's "present" titles — a yes/no fact, with no stock count.
--
--   MML = required titles on the shelf / required titles
--
-- Three things change on purpose, each because the old rule contradicts the
-- matrix:
--
-- 1. Grade A++ no longer means "every title in the sheet". That rule made a
--    title the matrix marks 2 (optional) for the shop's own column required,
--    and listed it as missing. An A++ shop is measured by its column like
--    every other shop: an A++ bookstore with A+ and A ("Kitob do'kon (A)"),
--    any other A++ shop by its type.
-- 2. The fractional category shares of db/21 (0,5 / 0,3 / 0,2) are not part of
--    the matrix. The importer refuses such a cell by name (lib/mmlParse.ts).
--    A share already stored gets no code, and a column still holding one is
--    "qoida_eskirgan": its shops show no MML at all — a partial figure that
--    silently skips the shares would read as real — until the sheet is pulled
--    again. That import replaces every code in one transaction, so it moves a
--    column from the old rule to the new one in a single step.
-- 3. A shop with no required title stays on the list with a state that says
--    why ("majburiy_yoq", or "ustun_yoq" when no matrix column matches its
--    type) instead of disappearing. It has no MML, never 100%.
--
-- Safe to re-run.

alter table mml_weights add column if not exists code smallint;
alter table mml_weights drop constraint if exists mml_weights_code_check;
alter table mml_weights add constraint mml_weights_code_check check (code in (0, 1, 2));
-- the codes db/21's weights already were; a share has none and is flagged below
update mml_weights set code = weight::int where code is null and weight in (0, 1);
alter table mml_weights alter column weight drop not null;

comment on column mml_weights.code is
  '1 = majburiy (required), 2 = ixtiyoriy (optional), 0 = not required (older sheets). '
  'A requirement, not a stock count. Null = an unconverted db/21 share: its column shows no MML until re-imported.';
comment on column mml_weights.weight is
  'Legacy db/21 weight. Not read since db/35 — code is.';

-- the share model goes; the views are rebuilt on codes
drop view if exists v_mml;
drop view if exists v_mml_share;
drop view if exists v_mml_status;
drop view if exists v_mml_book;
drop view if exists v_mml_pool_target;

-- the column each active store is measured against (db/21, minus the A++ rule)
create or replace view v_store_mml_column with (security_invoker = true) as
select s.id as store_id, s.code, s.name as store_name, s.store_type, s.grade,
       case
         when s.store_type = 'Kitob do''kon' then 'Kitob do''kon (' ||
              case when s.grade in ('A++', 'A+', 'A') then 'A'
                   when s.grade = 'B'                 then 'B'
                   else 'C' end || ')'
         else s.store_type
       end as mml_column
  from stores s
 where s.active;

-- every title that matters to a store, and whether it is required or optional
create view v_mml_book with (security_invoker = true) as
select c.store_id, c.code, c.store_name, c.mml_column,
       b.id as book_id, b.title, b.category as book_category,
       case when w.code = 1 then 'majburiy' else 'ixtiyoriy' end as kind
  from v_store_mml_column c
  join mml_weights w on w.mml_column = c.mml_column and w.code in (1, 2)
  join books b on b.id = w.book_id and b.active;

-- what is on the shelf: a hand-set value, else the last visit (db/27's
-- unfiltered visit lookups). The explicit option matters: create view without
-- it would leave this view security_invoker=false and widen every table it reads.
create view v_mml_status with (security_invoker = true) as
select m.store_id, m.code, m.store_name, m.mml_column,
       m.book_id, m.title, m.book_category, m.kind,
       lv.visited_at as oxirgi_vizit,
       coalesce(ss.present, sh.book_id is not null) as bor,
       ss.store_id is not null as qolda
  from v_mml_book m
  left join v_mml_last_visit lv on lv.store_id = m.store_id
  left join v_mml_shelf      sh on sh.store_id = m.store_id and sh.book_id = m.book_id
  left join store_stock      ss on ss.store_id = m.store_id and ss.book_id = m.book_id;

-- MML per store, every active store, with a state that says why it has none:
--   ustun_yoq       no matrix column matches the store's type
--   qoida_eskirgan  its column still holds an unconverted db/21 share
--   majburiy_yoq    its column requires nothing
--   olchanmagan     required titles, but no visit and no hand-set value yet
--   olchangan       measured: mml is set
-- Optional titles never count, and a hand-set value on one does not make a
-- store "measured".
create view v_mml with (security_invoker = true) as
with req as (
  select store_id,
         count(*)                    as kerak,
         count(*) filter (where bor) as bor,
         max(oxirgi_vizit)           as oxirgi_vizit,
         bool_or(qolda)              as qolda_bor
    from v_mml_status
   where kind = 'majburiy'
   group by store_id
), cols as (
  select mml_column, bool_or(code is null) as eskirgan
    from mml_weights
   group by mml_column
), st as (
  select c.store_id, c.code, c.store_name, c.mml_column,
         r.oxirgi_vizit, coalesce(r.qolda_bor, false) as qolda_bor,
         coalesce(r.kerak, 0) as kerak, coalesce(r.bor, 0) as bor,
         case when k.mml_column is null then 'ustun_yoq'
              when k.eskirgan           then 'qoida_eskirgan'
              when r.store_id is null   then 'majburiy_yoq'
              when r.oxirgi_vizit is null and not r.qolda_bor then 'olchanmagan'
              else 'olchangan'
         end as holat
    from v_store_mml_column c
    left join req  r on r.store_id = c.store_id
    left join cols k on k.mml_column = c.mml_column
)
select store_id, code, store_name, mml_column as store_category,
       oxirgi_vizit, qolda_bor,
       kerak::int, bor::int, (kerak - bor)::int as yetishmaydi,
       case when holat = 'olchangan' then round(100.0 * bor / kerak, 1) end as mml,
       holat
  from st;

grant select on v_store_mml_column, v_mml_book, v_mml_status, v_mml to falaq_app;

do $$
declare n int; c text;
begin
  select count(*), string_agg(distinct mml_column, ', ') into n, c from mml_weights where code is null;
  if n > 0 then
    raise notice 'db/35: % eski ulush qiymati (0,5 / 0,3 / 0,2) kodga aylantirilmadi (%). '
                 'Bu ustunlardagi do''konlar MML ko''rsatmaydi (qoida_eskirgan) — '
                 '/admin/mml da "Google Sheets''dan yangilash" ni bosing.', n, c;
  end if;
end $$;
