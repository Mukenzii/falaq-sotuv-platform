-- MML: which books must be on the shelf in which store, and how much of that
-- list is actually there (MML).
--
-- Books and stores are both ranked, and the rank decides the assortment: the
-- best stores take every category, a C store takes only the top ones. The rule
-- covers every store and every book automatically, so a new title does not
-- have to be ticked 44 times. Real life disagrees with the rule here and there
-- — those disagreements are kept per store rather than being flattened away.

alter table books  add column if not exists category text;
alter table stores add column if not exists category text;
create index if not exists books_category_idx  on books(category);
create index if not exists stores_category_idx on stores(category);

-- rank pair -> is this category of book expected in this category of store
create table if not exists mml_rules (
  store_category text not null,
  book_category  text not null,
  required       boolean not null default true,
  primary key (store_category, book_category)
);

-- the exceptions: one store, one book, decided by hand
create table if not exists mml_overrides (
  store_id bigint  not null references stores(id) on delete cascade,
  book_id  bigint  not null references books(id)  on delete cascade,
  required boolean not null,
  note     text,
  primary key (store_id, book_id)
);
create index if not exists mml_overrides_book_idx on mml_overrides(book_id);

alter table mml_rules     enable row level security; alter table mml_rules     force row level security;
alter table mml_overrides enable row level security; alter table mml_overrides force row level security;

-- Everyone signed in may read the list — a manager needs to know what belongs
-- in their shop. Only user-managers may change it.
drop policy if exists mr_read on mml_rules;
create policy mr_read on mml_rules for select using (current_user_id() is not null);
drop policy if exists mr_write on mml_rules;
create policy mr_write on mml_rules for all
  using (can_manage_users()) with check (can_manage_users());

drop policy if exists mo_read on mml_overrides;
create policy mo_read on mml_overrides for select using (current_user_id() is not null);
drop policy if exists mo_write on mml_overrides;
create policy mo_write on mml_overrides for all
  using (can_manage_users()) with check (can_manage_users());

-- security_invoker: without it a view runs as its owner, who has BYPASSRLS, and
-- a sotuv_manager selecting from it would see every store in the company.
-- (The older v_* views predate this and are only ever joined back to stores,
--  which is what keeps them honest.)

/** The full expected assortment: rule, with any per-store override winning. */
create or replace view v_store_mml with (security_invoker = true) as
select s.id   as store_id, s.code, s.name as store_name, s.category as store_category,
       b.id   as book_id, b.title, b.category as book_category,
       coalesce(o.required, r.required, false) as required,
       (o.book_id is not null)                 as is_override
  from stores s
  cross join books b
  left join mml_rules     r on r.store_category = s.category and r.book_category = b.category
  left join mml_overrides o on o.store_id = s.id and o.book_id = b.id
 where s.active and b.active;

/** The visit that says what is on the shelf right now: the most recent one. */
create or replace view v_store_last_visit with (security_invoker = true) as
select distinct on (v.store_id) v.store_id, v.id as visit_id, v.visited_at
  from visits v
 order by v.store_id, v.visited_at desc;

/** Every required title, and whether the last visit found it. */
create or replace view v_mml_status with (security_invoker = true) as
select m.store_id, m.code, m.store_name, m.store_category,
       m.book_id, m.title, m.book_category, m.is_override,
       lv.visited_at as oxirgi_vizit,
       (vb.book_id is not null) as bor
  from v_store_mml m
  left join v_store_last_visit lv on lv.store_id = m.store_id
  left join visit_books vb
         on vb.visit_id = lv.visit_id and vb.book_id = m.book_id and vb.status = 'present'
 where m.required;

/**
 * MML per store: of the titles that must be there, how many were.
 * A store never visited has no evidence, so it scores null rather than zero —
 * zero would read as "we looked and found nothing", which is a different fact.
 */
create or replace view v_mml with (security_invoker = true) as
select st.store_id, st.code, st.store_name, st.store_category,
       max(st.oxirgi_vizit)                      as oxirgi_vizit,
       count(*)                                  as kerak,
       count(*) filter (where st.bor)            as bor,
       count(*) filter (where not st.bor)        as yetishmaydi,
       case when max(st.oxirgi_vizit) is null then null
            else round(100.0 * count(*) filter (where st.bor) / nullif(count(*), 0), 1)
       end                                       as mml
  from v_mml_status st
 group by 1, 2, 3, 4;

grant select on v_store_mml, v_store_last_visit, v_mml_status, v_mml to falaq_app;
