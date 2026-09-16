-- Deleting a filed visit.
--
-- Until now nothing could remove a visit: managers file them, the weekly plan
-- counts them, and the spreadsheet is rewritten from them. That was right for a
-- manager — a visit is the evidence they were in the shop, not a draft they may
-- withdraw. It is wrong for an admin, who is the one who has to clean up a
-- duplicate, a visit filed against the wrong shop, or a training run.
--
-- So: only an admin deletes, and the deletion is written down. The row goes;
-- the fact that it existed does not.

create table if not exists deleted_visits (
  visit_id   uuid primary key,
  -- names are copied, not referenced: this log must outlive the shop and the
  -- person, and a cascade from either would erase the only record of the delete
  store_id   bigint,
  store_code text,
  manager_id uuid,
  manager    text,
  visited_at timestamptz,
  reason     text,
  deleted_by uuid references users(id) on delete set null,
  deleted_at timestamptz not null default now()
);

alter table deleted_visits enable row level security;
alter table deleted_visits force  row level security;

drop policy if exists dv_read on deleted_visits;
create policy dv_read on deleted_visits for select using (can_manage_users());

drop policy if exists dv_insert on deleted_visits;
create policy dv_insert on deleted_visits for insert with check (can_manage_users());

-- The app role may write the log and read it, and may not touch it afterwards,
-- so "who removed that visit" has one answer and it stays put. The revoke is
-- the part that does the work: db/00_roles.sql sets default privileges that
-- hand falaq_app select/insert/update/delete on every new table, so granting
-- only the first two here would change nothing.
grant  select, insert   on deleted_visits to falaq_app;
revoke update, delete   on deleted_visits from falaq_app;

-- The delete itself. v_update already lets a manager fix their own visit for 24
-- hours; removing one is a different power and belongs to admins alone.
drop policy if exists v_delete on visits;
create policy v_delete on visits for delete using (can_manage_users());

grant delete on visits, visit_books, visit_photos, visit_answers to falaq_app;

comment on table deleted_visits is
  'Audit log: one row per visit an admin removed. Written by /api/visits/[id] DELETE.';
