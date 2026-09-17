-- Regions, store assignment, and the gate on filing a visit.
--
-- Three things arrive together because they are one decision:
--
-- 1. A region is one of Uzbekistan's 14 administrative units, not the 4-digit
--    code prefix. The prefix is a DISTRICT: there are 120 of them across 661
--    shops, which is not something a person can be given. The first two digits
--    are the region and the last two the district inside it, so the region is
--    read off the store code exactly as the team reads it by eye.
--
-- 2. stores.owner_id decides what a manager sees and may file. It was retired
--    in db/16 ("any shop can be given to anyone") — that is no longer how the
--    team works: one region per person, and the shops in it are theirs.
--
-- 3. So v_insert goes back to checking the shop, not just the person.

create table if not exists regions (
  code text primary key,          -- first two digits of a store code
  name text not null unique,      -- also the name of its tab in the spreadsheet
  sort int  not null default 0
);

insert into regions (code, name, sort) values
  ('01', 'Toshkent shahri',   1),
  ('10', 'Toshkent viloyati', 2),
  ('20', 'Sirdaryo',          3),
  ('25', 'Jizzax',            4),
  ('30', 'Samarqand',         5),
  ('40', 'Farg''ona',         6),
  ('50', 'Namangan',          7),
  ('60', 'Andijon',           8),
  ('70', 'Qashqadaryo',       9),
  ('75', 'Surxandaryo',      10),
  ('80', 'Buxoro',           11),
  ('85', 'Navoiy',           12),
  ('90', 'Xorazm',           13),
  ('95', 'Qoraqalpog''iston',14),
  -- KR / KZ / RUS / MISR shops and anything whose code says nothing
  ('XX', 'Boshqa',           99)
on conflict (code) do update set name = excluded.name, sort = excluded.sort;

alter table regions enable row level security;
drop policy if exists r_read  on regions;
drop policy if exists r_write on regions;
create policy r_read  on regions for select using (current_user_id() is not null);
create policy r_write on regions for all
  using (can_manage_users()) with check (can_manage_users());
grant select, insert, update, delete on regions to falaq_app;

/*
 * Which region a shop is in.
 *
 * territory first ("40 Farg'ona", "0101 Shayhontohur") because it is the
 * curated column in the sheet and it is right even when the code is not — one
 * shop is coded by its phone number, and the eight KG shops are served out of
 * Namangan. The code prefix is the fallback for the shops the sheet has no
 * territory for. Anything left over is 'XX' rather than null, so no visit can
 * fall out of the export by having nowhere to go.
 */
create or replace function region_code_of(p_code text, p_territory text)
returns text language sql stable as $$
  with n as (
    select coalesce(
      nullif(substring(coalesce(p_territory, '') from '^[0-9]+'), ''),
      nullif(substring(coalesce(p_code, '')      from '^[0-9]+'), '')) as digits
  ), d as (
    select case when digits is null then null
                when length(digits) >= 4 then left(digits, 2)
                else lpad(digits, 2, '0') end as code from n
  )
  select coalesce((select r.code from regions r join d on r.code = d.code), 'XX');
$$;

alter table stores add column if not exists region_code text
  not null default 'XX' references regions(code);
create index if not exists stores_region_code_idx on stores(region_code);
comment on column stores.region_code is
  'Region (viloyat). Derived from the code/territory by region_code_of(); kept by trigger.';

-- Derived, never typed: an import that adds a shop must not be able to forget it.
create or replace function stores_set_region() returns trigger language plpgsql as $$
begin
  new.region_code := region_code_of(new.code, new.territory);
  return new;
end $$;

drop trigger if exists stores_region_bi on stores;
-- every insert and every update, not just `update of code, territory`: the
-- narrow form let an UPDATE that touched only region_code through untouched,
-- so a shop could be typed into another region head's tab by hand. The whole
-- point of deriving it is that there is one answer and no way to disagree
-- with it.
create trigger stores_region_bi before insert or update on stores
  for each row execute function stores_set_region();

update stores set region_code = region_code_of(code, territory)
 where region_code is distinct from region_code_of(code, territory);

-- One region per person. Directors and heads keep null: they are not on a route.
alter table users add column if not exists region_code text references regions(code);
create index if not exists users_region_code_idx on users(region_code);
comment on column users.region_code is
  'The region this person works. Assignment itself is stores.owner_id.';

comment on column stores.owner_id is
  'Who visits this shop. Set in bulk per region from /admin/users. Gates v_insert.';

-- A visit may only be filed against a shop that is this person''s.
drop policy if exists v_insert on visits;
create policy v_insert on visits for insert
  with check (
    manager_id = current_user_id()
    and store_id in (select id from stores where owner_id = current_user_id())
  );

-- Shops assigned to me, and how overdue each one is. The new-visit form is the
-- only caller; it used to read the whole store table and filter in the browser.
create or replace view v_menga_biriktirilgan as
select s.id, s.code, s.name, s.region, s.region_code, s.territory, s.store_type,
       s.owner_id, r.name as hudud,
       max(v.visited_at) as oxirgi_vizit,
       coalesce(date_part('day', now() - max(v.visited_at))::int, 999) as kun_otdi,
       s.visit_every_days
  from stores s
  join regions r on r.code = s.region_code
  left join visits v on v.store_id = s.id
 where s.active
 group by s.id, r.name;

grant select on v_menga_biriktirilgan to falaq_app;
