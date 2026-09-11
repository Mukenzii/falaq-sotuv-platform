-- Weekly plan: which shops each person must visit this week, and whether they did.
--
-- Territory is gone. Stores used to belong to a manager (stores.owner_id) and
-- that ownership decided both who could see a shop and who could file a visit
-- for it. The team does not work that way — any shop can be given to anyone —
-- so the plan is now the only thing that says who should go where, and every
-- signed-in person can see every shop.
--
-- The hierarchy still applies to PEOPLE: who can see whose visits and whose
-- plan is still descendants(). That part was never about stores.

-- 1. stores are no longer owned by anyone
drop policy if exists s_read on stores;
create policy s_read on stores for select using (current_user_id() is not null);

-- and a visit may be filed against any store that exists. The old rule was
-- "a store you can see", which was the territory check in disguise.
drop policy if exists v_insert on visits;
create policy v_insert on visits for insert
  with check (manager_id = current_user_id());

-- stores.owner_id is left in place so nothing that reads it breaks, but it no
-- longer grants or withholds anything.
comment on column stores.owner_id is
  'Historical. Territory was dropped 2026-09-11; the weekly plan says who visits what.';

-- 2. the plan itself
create table if not exists week_plans (
  week_start date   not null,                       -- Monday, always
  store_id   bigint not null references stores(id) on delete cascade,
  user_id    uuid   not null references users(id)  on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null,
  -- one shop belongs to one person in a given week: otherwise "who missed it"
  -- has no answer
  primary key (week_start, store_id)
);
create index if not exists week_plans_user_idx on week_plans(user_id, week_start);

alter table week_plans enable row level security;
alter table week_plans force  row level security;

-- You see your own week and the weeks of everyone under you; admins write it.
drop policy if exists wp_read on week_plans;
create policy wp_read on week_plans for select
  using (user_id in (select my_team()) or can_manage_users());
drop policy if exists wp_write on week_plans;
create policy wp_write on week_plans for all
  using (can_manage_users()) with check (can_manage_users());

grant select, insert, update, delete on week_plans to falaq_app;

-- Monday of whatever week a date falls in. date_trunc('week') is Monday-based
-- in Postgres, which is what the team works to.
create or replace function week_of(d timestamptz default now()) returns date
language sql immutable as $$ select (date_trunc('week', d))::date $$;

/**
 * Whether a given person visited a given shop in a given week — as a FACT.
 *
 * v_week_plan is security_invoker so that wp_read decides which plan rows you
 * may see. But the completion lookup must not run under the viewer's
 * permissions: a direktor who cannot see a manager's visits (because that
 * manager sits outside their subtree) was shown "not done" for work that was
 * done. Whether the shop was visited is not a matter of who is asking.
 *
 * SECURITY DEFINER, owned by falaq_owner (BYPASSRLS). It leaks nothing beyond
 * a timestamp for a (store, person, week) the caller already has a plan row
 * for — and wp_read already decided they may see that row.
 */
create or replace function plan_visit_at(p_store bigint, p_user uuid, p_week date)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(v.visited_at) from visits v
   where v.store_id = p_store
     and v.manager_id = p_user
     and v.visited_at >= p_week
     and v.visited_at <  p_week + 7
$$;

/** Same, but by anyone at all: "somebody covered this shop". */
create or replace function plan_any_visit_at(p_store bigint, p_week date)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select max(v.visited_at) from visits v
   where v.store_id = p_store
     and v.visited_at >= p_week
     and v.visited_at <  p_week + 7
$$;

-- CREATE OR REPLACE cannot remove a column from a view, and v_week_summary
-- depends on this one, so both are dropped in order first.
drop view if exists v_week_summary;
drop view if exists v_week_plan;

create or replace view v_week_plan with (security_invoker = true) as
select p.week_start, p.user_id, u.full_name, p.store_id, s.code, s.name as store_name,
       s.category as store_category,
       plan_visit_at(p.store_id, p.user_id, p.week_start)     as visited_at,
       plan_visit_at(p.store_id, p.user_id, p.week_start) is not null as bajarildi,
       plan_any_visit_at(p.store_id, p.week_start)            as boshqa_vizit
  from week_plans p
  join users  u on u.id = p.user_id
  join stores s on s.id = p.store_id;

create or replace view v_week_summary with (security_invoker = true) as
select week_start, user_id, full_name,
       count(*)                              as reja,
       count(*) filter (where bajarildi)     as bajarildi,
       count(*) filter (where not bajarildi) as qoldi,
       round(100.0 * count(*) filter (where bajarildi) / nullif(count(*), 0), 1) as foiz
  from v_week_plan
 group by 1, 2, 3;

grant select on v_week_plan, v_week_summary to falaq_app;
