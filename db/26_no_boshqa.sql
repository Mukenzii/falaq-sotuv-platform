-- There is no "Boshqa" region.
--
-- db/25 put every shop that could not be placed into a catch-all region so
-- that no visit could fall out of the export. That was the wrong shape: a
-- region is a real place someone drives to, and a bucket holding a Korean
-- marketplace next to a shop with a missing code is not one.
--
-- The rule is now the one the team actually uses:
--
--   * a shop whose location is known belongs to one of the 14 regions;
--   * a shop abroad (KR, KZ, RUS, MISR) is left alone — nobody can visit it,
--     so nobody is given it and it is not tracked;
--   * a shop with no location at all — the online ones, and a few whose code
--     was never filled in — has NO region until the sheet says where it is.
--
-- So region_code becomes nullable. Nothing is invented to fill it.

-- 1. unknown is now null, not 'XX'
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
  -- no coalesce: a shop we cannot place has no region, and says so
  select (select r.code from regions r join d on r.code = d.code);
$$;

alter table stores alter column region_code drop default;
alter table stores alter column region_code drop not null;

-- 2. re-derive, which empties 'XX'
update stores set region_code = region_code_of(code, territory)
 where region_code is distinct from region_code_of(code, territory);

delete from regions where code = 'XX';

comment on column stores.region_code is
  'Region (viloyat), derived by region_code_of() and kept by trigger. NULL when '
  'the shop has no location yet, or is abroad — neither is visitable.';

-- 3. the assigned-shops view must not drop a shop for having no region
create or replace view v_menga_biriktirilgan as
select s.id, s.code, s.name, s.region, s.region_code, s.territory, s.store_type,
       s.owner_id, r.name as hudud,
       max(v.visited_at) as oxirgi_vizit,
       coalesce(date_part('day', now() - max(v.visited_at))::int, 999) as kun_otdi,
       s.visit_every_days
  from stores s
  left join regions r on r.code = s.region_code
  left join visits v on v.store_id = s.id
 where s.active
 group by s.id, r.name;

grant select on v_menga_biriktirilgan to falaq_app;

-- 4. what still needs a location put in the sheet. Not a view of failures —
-- a worklist: every one of these is a shop nobody can be given.
create or replace view v_hududsiz as
select s.id, s.code, s.name, s.store_type, s.agent
  from stores s
 where s.active and s.region_code is null
 order by s.code;

grant select on v_hududsiz to falaq_app;
