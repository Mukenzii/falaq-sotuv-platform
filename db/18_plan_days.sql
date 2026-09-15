-- Weekly plan gets a day: the admin says not only which shops, but on which
-- day of the week each one is to be visited.
--
-- Rule decided by the team:
--   visit on (or before) the planned day, by the assigned person -> bajarildi
--   visit later in the same week                                -> kechikdi (still counts)
--   no visit and the planned day has passed, week still open     -> kechikmoqda
--   no visit by the end of the week                              -> borilmadi
--   otherwise                                                    -> bugun / rejada
--
-- A shop is still planned once per week (PK week_start, store_id): the day is
-- an attribute of that one task, not a second task.
--
-- Dates are compared in the server timezone, which both compose files pin to
-- Asia/Tashkent — same as every other week calculation in db/16.

alter table week_plans add column if not exists visit_date date;
update week_plans set visit_date = week_start where visit_date is null;
alter table week_plans alter column visit_date set not null;

alter table week_plans drop constraint if exists week_plans_day_in_week;
alter table week_plans add constraint week_plans_day_in_week
  check (visit_date >= week_start and visit_date < week_start + 7);

drop view if exists v_week_summary;
drop view if exists v_week_plan;

-- plan_visit_at() is the FIRST visit by that person that week, SECURITY
-- DEFINER (see db/16). The lateral references the outer row, so it is
-- evaluated per plan row and not hoisted.
create view v_week_plan with (security_invoker = true) as
select p.week_start, p.visit_date, p.user_id, u.full_name, p.store_id, s.code,
       s.name as store_name, s.category as store_category,
       f.first_at                    as visited_at,
       f.first_at is not null        as bajarildi,
       plan_any_visit_at(p.store_id, p.week_start) as boshqa_vizit,
       case
         when f.first_at is not null and f.first_at::date <= p.visit_date then 'bajarildi'
         when f.first_at is not null                                     then 'kechikdi'
         when p.week_start + 7 <= current_date                           then 'borilmadi'
         when p.visit_date < current_date                                then 'kechikmoqda'
         when p.visit_date = current_date                                then 'bugun'
         else 'rejada'
       end as holat
  from week_plans p
  join users  u on u.id = p.user_id
  join stores s on s.id = p.store_id
  cross join lateral (
    select plan_visit_at(p.store_id, p.user_id, p.week_start) as first_at
  ) f;

-- bajarildi keeps its meaning "the task is closed", late visits included;
-- vaqtida / kechikdi split it.
create view v_week_summary with (security_invoker = true) as
select week_start, user_id, full_name,
       count(*)                                     as reja,
       count(*) filter (where bajarildi)            as bajarildi,
       count(*) filter (where holat = 'bajarildi')  as vaqtida,
       count(*) filter (where holat = 'kechikdi')   as kechikdi,
       count(*) filter (where not bajarildi)        as qoldi,
       count(*) filter (where holat = 'borilmadi')  as borilmadi,
       round(100.0 * count(*) filter (where bajarildi) / nullif(count(*), 0), 1) as foiz
  from v_week_plan
 group by 1, 2, 3;

grant select on v_week_plan, v_week_summary to falaq_app;
