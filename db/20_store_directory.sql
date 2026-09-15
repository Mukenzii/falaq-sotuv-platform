-- Store directory from the "Sotuv uchun" spreadsheet.
--
-- The sheet is the source of truth for the list of shops: "Do'konlar yangi"
-- (name, type, responsible agent, code, territory) and "Do'konlar" (grade).
-- lib/storeImport.ts upserts by stores.code and marks shops that left the
-- sheet inactive — never deleted, since visits and plans point at them.
--
-- store_type is the sheet's "Тип заведения" (Kitob do'kon, Kanselyariya, ...).
-- It is NOT stores.category, which is the MML must-list column label
-- ("Kitob do'kon (A)") and stays owned by the MML import.

alter table stores add column if not exists territory  text;
alter table stores add column if not exists store_type text;
alter table stores add column if not exists grade      text;
alter table stores add column if not exists agent      text;
alter table stores add column if not exists sheet_kod  text;
alter table stores add column if not exists synced_at  timestamptz;

alter table stores drop constraint if exists stores_grade_check;
alter table stores add constraint stores_grade_check
  check (grade is null or grade in ('A++', 'A+', 'A', 'B', 'C'));

create index if not exists stores_territory_idx  on stores(territory);
create index if not exists stores_store_type_idx on stores(store_type);

comment on column stores.territory  is 'Sheet "Territoriya", e.g. "0104 Chilonzor", "30 Samarqand". Filter key.';
comment on column stores.store_type is 'Sheet "Тип заведения". Not the MML category.';
comment on column stores.grade      is 'Sheet tab "Dokonlar": A++ / A+ / A / B / C.';
comment on column stores.synced_at  is 'Last time the sheet import touched this row.';
