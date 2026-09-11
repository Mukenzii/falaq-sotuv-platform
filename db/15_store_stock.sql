-- "Is this book actually in the shop?" — set by hand, without a visit.
--
-- Until now the only answer came from the last visit's visit_books, which is
-- right for a field record but useless in two everyday cases: a store nobody
-- has visited yet, and a title just added to the must-list that no past visit
-- could possibly have mentioned. Both show up red with no way to correct them.
--
-- This is a separate layer on purpose. A visit is what a manager saw on a
-- given day; an admin editing that row from an analytics screen would be
-- rewriting history. So the manual value sits beside it and wins when set,
-- exactly like mml_overrides sits beside mml_rules.

create table if not exists store_stock (
  store_id   bigint  not null references stores(id) on delete cascade,
  book_id    bigint  not null references books(id)  on delete cascade,
  present    boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null,
  primary key (store_id, book_id)
);
create index if not exists store_stock_book_idx on store_stock(book_id);

alter table store_stock enable row level security;
alter table store_stock force  row level security;

-- Anyone signed in may read it; it is the same information the visit already
-- shows. Writing is for whoever runs the assortment, or the manager whose
-- territory the store is in — they are the one standing in front of the shelf.
drop policy if exists ss_read on store_stock;
create policy ss_read on store_stock for select using (current_user_id() is not null);

drop policy if exists ss_write on store_stock;
create policy ss_write on store_stock for all
  using (
    can_manage_users()
    or store_id in (select id from stores where owner_id in (select my_team()))
  )
  with check (
    can_manage_users()
    or store_id in (select id from stores where owner_id in (select my_team()))
  );

grant select, insert, update, delete on store_stock to falaq_app;

-- Rebuild the status view so the manual value wins where it exists.
create or replace view v_mml_status with (security_invoker = true) as
select m.store_id, m.code, m.store_name, m.store_category,
       m.book_id, m.title, m.book_category, m.is_override,
       lv.visited_at as oxirgi_vizit,
       coalesce(ss.present, vb.book_id is not null) as bor,
       (ss.store_id is not null)                    as qolda,   -- set by hand
       ss.updated_at                                as qolda_vaqti
  from v_store_mml m
  left join v_store_last_visit lv on lv.store_id = m.store_id
  left join visit_books vb
         on vb.visit_id = lv.visit_id and vb.book_id = m.book_id
        and vb.status = 'present'
  left join store_stock ss on ss.store_id = m.store_id and ss.book_id = m.book_id
 where m.required;

-- CREATE OR REPLACE cannot insert a column in the middle of a view, so the
-- old one has to go first. Dropping is safe: nothing holds a dependency on it.
drop view if exists v_mlrr;
drop view if exists v_mml;

/**
 * MML compliance. A store now counts as measured if it has EITHER a visit or a hand-set
 * stock value — otherwise a shop someone has filled in by hand would still
 * report "never visited" and be left out of the company figure.
 */
create or replace view v_mml with (security_invoker = true) as
select st.store_id, st.code, st.store_name, st.store_category,
       max(st.oxirgi_vizit)               as oxirgi_vizit,
       bool_or(st.qolda)                  as qolda_bor,
       count(*)                           as kerak,
       count(*) filter (where st.bor)     as bor,
       count(*) filter (where not st.bor) as yetishmaydi,
       case when max(st.oxirgi_vizit) is null and not bool_or(st.qolda) then null
            else round(100.0 * count(*) filter (where st.bor) / nullif(count(*), 0), 1)
       end                                as mml
  from v_mml_status st
 group by 1, 2, 3, 4;

grant select on v_mml_status, v_mml to falaq_app;
