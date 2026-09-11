-- ############################################################################
-- ##  DEVELOPMENT ONLY — NEVER RUN THIS AGAINST PRODUCTION.                 ##
-- ##  PRODUCTIONDA ISHLATMANG. It inserts invented visits.                  ##
-- ##  Nothing loads it automatically: it lives in scripts/, not db/.        ##
-- ############################################################################
-- Demo data for looking at the dashboard. NOT in db/, so a fresh install never
-- loads it automatically. Run it deliberately:
--   docker compose exec -T db psql -U falaq_owner -d falaq < scripts/demo-data.sql
--
-- Clears every visit first, so it is safe to re-run and never doubles up.
--
-- `npm test` also clears visits in its setup hook, so re-run this after a test
-- run if you want the dashboards populated again.

begin;

delete from visit_photos;
delete from visit_books;
delete from visits;

-- Give each manager a territory, round-robin over the region codes, so the
-- hierarchy filtering on the dashboard has something real to hide.
with mgr as (
  select id, row_number() over (order by full_name) - 1 as n
  from users where role = 'sotuv_manager' and active
), regions as (
  select region, row_number() over (order by region) - 1 as r
  from (select distinct region from stores) x
)
update stores s
set owner_id = m.id
from regions g, mgr m
where s.region = g.region
  and m.n = g.r % (select count(*) from mgr);

-- ~90 days of visits. Each manager works their own stores, more on weekdays,
-- with a plausible spread of outcomes rather than uniform noise.
insert into visits (
  manager_id, store_id, visited_at, width_m, height_m, open_from, open_to,
  placement, facing, shelf_heights, visit_result, no_order_reason,
  debt_status, cash_collected, note, lat, lng)
select
  s.owner_id,
  s.id,
  d.day
    + (interval '1 hour' * (9 + floor(random() * 9)))
    + (interval '1 minute' * floor(random() * 60)),
  round((2 + random() * 8)::numeric, 1),
  round((2 + random() * 7)::numeric, 1),
  '09:00'::time,
  (array['18:00','20:00','20:30','22:00'])[1 + floor(random() * 4)]::time,
  case floor(random() * 7)::int
    when 0 then array['Kirish yo''lida / vitrinada']
    when 1 then array['Kirish yo''lida / vitrinada','O''ng tomonda']
    when 2 then array['O''ng tomonda','To''g''rida / o''rtada']
    when 3 then array['Chap tomonda']
    when 4 then array['Kassa yonida']
    when 5 then array['Do''kon ichkarisida / burchakda']
    else array['Ko''rinmaydi']
  end,
  (array['face','face','face','qisman_face','qisman_face','koreshok','qutida'])[1 + floor(random() * 7)]::visit_facing,
  case floor(random() * 4)::int
    when 0 then array['Ko''z darajasida (135–160 sm)']
    when 1 then array['Ko''z darajasida (135–160 sm)','Qo''l darajasida (100–135 sm)']
    when 2 then array['Qo''l darajasida (100–135 sm)']
    else array['Pastda (100 sm dan past)']
  end,
  case when random() < 0.42
       then array['Kirdim / Taklif berdim','Buyurtma oldim']
       else array['Kirdim / Taklif berdim'] end,
  case when random() < 0.42 then null
       else (array['Eski zaxira bor / hali sotilmagan','Puli yo''q / qarzi bor',
                   'Narx qimmat deb hisoblaydi','Boshqa nashriyot bilan ishlaydi'])[1 + floor(random() * 4)] end,
  (array['Qarz yo''q','Qarz yo''q','Qarz bor, muddati kelmagan','Muddati o''tgan qarz bor','Bugun to''ladi'])[1 + floor(random() * 5)],
  case when random() < 0.55 then round((random() * 4000000)::numeric, -3) else null end,
  case when random() < 0.12 then 'Egasi yangi kitoblar so''radi' else null end,
  41.31 + random() * 0.08,
  69.24 + random() * 0.08
from stores s
cross join lateral (
  -- the offset must depend on BOTH the store and the visit number, or Postgres
  -- hoists this subquery and every store lands on the same handful of dates
  select (current_date - (abs(('x' || substr(md5(s.id::text || 'day' || g), 1, 8))::bit(32)::int) % 90))::timestamptz as day
  from generate_series(1, 7) g               -- up to 7 visits per store over 3 months
) d
where s.active and s.owner_id is not null
  and extract(dow from d.day) <> 0           -- nobody works Sunday
;

-- Which of our books each visit found on the shelf, and which had gone stale.
--
-- NOTE: do not reach for random() here. A LIMIT expression is evaluated ONCE per
-- statement, and an uncorrelated LATERAL subquery gets hoisted and reused — both
-- give every visit an identical set. Hash the (visit, book) pair instead: the
-- value depends on both, so the spread is real.
insert into visit_books (visit_id, book_id, status)
select v.id, b.id, 'present'
from visits v
join books b on b.active
where abs(('x' || substr(md5(v.id::text || 'present' || b.id::text), 1, 8))::bit(32)::int % 100) < 34
on conflict do nothing;

insert into visit_books (visit_id, book_id, status)
select v.id, b.id, 'stale'
from visits v
join books b on b.active
where abs(('x' || substr(md5(v.id::text || 'stale' || b.id::text), 1, 8))::bit(32)::int % 100) < 6
  -- a title cannot be both on display and gone stale in the same visit
  and not exists (
    select 1 from visit_books vb
     where vb.visit_id = v.id and vb.book_id = b.id and vb.status = 'present')
on conflict do nothing;

commit;

select 'visits' t, count(*) from visits
union all select 'visit_books', count(*) from visit_books
union all select 'stores with an owner', count(*) from stores where owner_id is not null;
