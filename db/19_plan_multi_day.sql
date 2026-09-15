-- A shop can be planned on several days of the same week (e.g. Monday AND
-- Thursday). Each planned day is its own task, done or not on its own.
--
-- Key moves from (week_start, store_id) to (store_id, visit_date): one person
-- per shop per day.
--
-- Matching a visit to a task: tasks for the same (week, shop, person) split the
-- week into windows. The first task's window starts on Monday (so an early
-- visit still counts, as before); every task's window ends where the next task
-- of that shop for that person begins, or at the end of the week. The first
-- visit inside the window closes the task — on or before its day = bajarildi,
-- after = kechikdi. One visit therefore never closes two tasks. With a single
-- task the window is the whole week, i.e. exactly the rule from db/18.

alter table week_plans drop constraint if exists week_plans_pkey;
alter table week_plans add constraint week_plans_pkey primary key (store_id, visit_date);
create index if not exists week_plans_week_idx on week_plans(week_start, store_id);

/** First visit by a person to a shop in [p_from, p_to). SECURITY DEFINER — see db/16. */
create or replace function plan_visit_between(p_store bigint, p_user uuid, p_from date, p_to date)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(v.visited_at) from visits v
   where v.store_id = p_store
     and v.manager_id = p_user
     and v.visited_at >= p_from
     and v.visited_at <  p_to
$$;

drop view if exists v_week_summary;
drop view if exists v_week_plan;

create view v_week_plan with (security_invoker = true) as
with t as (
  select p.*,
         case when lag(p.visit_date) over w is null then p.week_start else p.visit_date end as win_from,
         coalesce(lead(p.visit_date) over w, p.week_start + 7)                            as win_to
    from week_plans p
  window w as (partition by p.week_start, p.store_id, p.user_id order by p.visit_date)
)
select t.week_start, t.visit_date, t.user_id, u.full_name, t.store_id, s.code,
       s.name as store_name, s.category as store_category,
       f.first_at                    as visited_at,
       f.first_at is not null        as bajarildi,
       plan_any_visit_at(t.store_id, t.week_start) as boshqa_vizit,
       case
         when f.first_at is not null and f.first_at::date <= t.visit_date then 'bajarildi'
         when f.first_at is not null                                     then 'kechikdi'
         when t.week_start + 7 <= current_date                           then 'borilmadi'
         when t.visit_date < current_date                                then 'kechikmoqda'
         when t.visit_date = current_date                                then 'bugun'
         else 'rejada'
       end as holat
  from t
  join users  u on u.id = t.user_id
  join stores s on s.id = t.store_id
  cross join lateral (
    select plan_visit_between(t.store_id, t.user_id, t.win_from, t.win_to) as first_at
  ) f;

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
