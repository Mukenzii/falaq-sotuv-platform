-- The plan summary per calendar month, beside the weekly one (v_week_summary).
--
-- Agents asked to see their week AND their month: how many shops the plan gave
-- them, how many they visited on time, late, not at all. The columns are the
-- weekly ones, so the two tables read the same.
--
-- A task belongs to the month of its planned day (visit_date). Its status is
-- still decided inside its own week exactly as v_week_plan decides it, so a
-- task planned for Friday 31 October and visited on Saturday 1 November is a
-- late visit counted in October; November does not see it at all.
--
-- A function rather than a view: v_week_plan's window functions are partitioned
-- by week, so a month filter on the outside cannot reach under them and every
-- week in history would be computed first. Bounding week_start here keeps it to
-- the five or six weeks that touch the month.
--
-- Runs as the caller (not SECURITY DEFINER): week_plans and users RLS decide
-- whose rows come back — an agent their own, a head their regions' managers,
-- an admin everyone. Safe to re-run.

create or replace function month_summary(p_month date)
returns table (
  month_start date, user_id uuid, full_name text,
  reja bigint, bajarildi bigint, vaqtida bigint, kechikdi bigint,
  qoldi bigint, borilmadi bigint, foiz numeric
)
language sql stable as $$
  with m as (select date_trunc('month', p_month)::date as m0)
  select m.m0, p.user_id, p.full_name,
         count(*),
         count(*) filter (where p.bajarildi),
         count(*) filter (where p.holat = 'bajarildi'),
         count(*) filter (where p.holat = 'kechikdi'),
         count(*) filter (where not p.bajarildi),
         count(*) filter (where p.holat = 'borilmadi'),
         round(100.0 * count(*) filter (where p.bajarildi) / nullif(count(*), 0), 1)
    from m
    join v_week_plan p
      on p.week_start between m.m0 - 6 and (m.m0 + interval '1 month')::date - 1
     and p.visit_date >= m.m0
     and p.visit_date <  (m.m0 + interval '1 month')::date
   group by m.m0, p.user_id, p.full_name
$$;

comment on function month_summary(date) is
  'Plan summary for the calendar month containing p_month; same columns as v_week_summary. RLS applies.';

grant execute on function month_summary(date) to falaq_app;
