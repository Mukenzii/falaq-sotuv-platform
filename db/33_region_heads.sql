-- Region heads: several regions each, and the weekly plan for the managers
-- who work them.
--
-- Until now a person had one region (users.region_code, db/25) and only an
-- admin could write the plan. A hudud_rahbari runs more than one region and
-- plans the week for the managers in it. Decided 2026-10-29:
--
-- 1. user_regions holds a head's regions, any number of them. Managers keep
--    their one region in users.region_code — for someone on a route that is
--    still the meaning of "the region this person works".
-- 2. A head's workers are the managers whose region is one of the head's
--    regions, whoever they report to in the org chart.
-- 3. A head may add, move, hand over and remove plan tasks and repeating
--    rules, for those workers and for shops in those regions. Admins keep
--    every right they had. can_plan() is that rule, and every write policy on
--    the plan tables says nothing else.
-- 4. A head may see those workers (u_read). Without it their tasks would not
--    even show: v_week_plan joins users under the viewer's RLS.
--
-- Safe to re-run.

create table if not exists user_regions (
  user_id     uuid not null references users(id)   on delete cascade,
  region_code text not null references regions(code) on delete cascade,
  primary key (user_id, region_code)
);
create index if not exists user_regions_region_idx on user_regions(region_code);

alter table user_regions enable row level security;
alter table user_regions force  row level security;
drop policy if exists ur_read      on user_regions;
-- the names production's first version of this table used
drop policy if exists ur_insert    on user_regions;
drop policy if exists ur_update    on user_regions;
drop policy if exists ur_delete    on user_regions;
drop policy if exists ur_write_ins on user_regions;
drop policy if exists ur_write_upd on user_regions;
drop policy if exists ur_write_del on user_regions;
-- which regions a head runs is no secret, and the staff list shows it
create policy ur_read      on user_regions for select using (current_user_id() is not null);
create policy ur_write_ins on user_regions for insert with check (can_manage_users());
create policy ur_write_upd on user_regions for update
  using (can_manage_users()) with check (can_manage_users());
create policy ur_write_del on user_regions for delete using (can_manage_users());
grant select, insert, update, delete on user_regions to falaq_app;

comment on table user_regions is
  'Regions a hudud_rahbari runs (any number). Managers use users.region_code (one).';

-- A head who had a single region in users.region_code keeps it, in the new place.
insert into user_regions (user_id, region_code)
select id, region_code from users where role = 'hudud_rahbari' and region_code is not null
on conflict do nothing;
update users set region_code = null where role = 'hudud_rahbari' and region_code is not null;

-- Someone who stops being a head stops running regions, whichever way the role
-- was changed.
create or replace function clear_former_head_regions() returns trigger
language plpgsql as $$
begin
  if old.role = 'hudud_rahbari' and new.role <> 'hudud_rahbari' then
    delete from user_regions where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_clear_former_head_regions on users;
create trigger trg_clear_former_head_regions after update of role on users
  for each row execute function clear_former_head_regions();

-- security definer for the same reason as my_role(): these read users and are
-- called from users' own policy, which would otherwise re-enter itself.

/** The regions the signed-in person runs as a head. Empty for everyone else. */
create or replace function my_regions() returns setof text
language sql stable security definer set search_path = public as $$
  select r.region_code from user_regions r
   where r.user_id = current_user_id() and my_role() = 'hudud_rahbari';
$$;

/** Managers who work one of my regions — a head's workers. */
create or replace function my_region_workers() returns setof uuid
language sql stable security definer set search_path = public as $$
  select u.id from users u
   where u.role = 'sotuv_manager' and u.region_code in (select my_regions());
$$;

/**
 * May the signed-in person plan this shop for this person? An admin, always.
 * A head, when the person is an active manager in one of the head's regions
 * and the shop is in one of them too.
 */
create or replace function can_plan(p_user uuid, p_store bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select can_manage_users() or (
        exists (select 1 from users u
                 where u.id = p_user and u.active and u.role = 'sotuv_manager'
                   and u.region_code in (select my_regions()))
    and exists (select 1 from stores s
                 where s.id = p_store and s.region_code in (select my_regions())));
$$;

/** May the signed-in person plan anything at all? Decides whether the board is editable. */
create or replace function can_plan_any() returns boolean
language sql stable security definer set search_path = public as $$
  select can_manage_users() or exists (select 1 from my_regions());
$$;

-- People: a head sees the workers of their regions as well as their own branch.
drop policy if exists u_read on users;
create policy u_read on users for select
  using (my_role() = 'direktor' or id in (select my_team()) or id in (select my_region_workers()));

-- The plan: read your branch and your region's workers; write what can_plan() allows.
drop policy if exists wp_read on week_plans;
create policy wp_read on week_plans for select
  using (user_id in (select my_team()) or user_id in (select my_region_workers()) or can_manage_users());
drop policy if exists week_plans_write_ins on week_plans;
drop policy if exists week_plans_write_upd on week_plans;
drop policy if exists week_plans_write_del on week_plans;
create policy week_plans_write_ins on week_plans for insert with check (can_plan(user_id, store_id));
create policy week_plans_write_upd on week_plans for update
  using (can_plan(user_id, store_id)) with check (can_plan(user_id, store_id));
create policy week_plans_write_del on week_plans for delete using (can_plan(user_id, store_id));

drop policy if exists pr_read on plan_rules;
create policy pr_read on plan_rules for select
  using (user_id in (select my_team()) or user_id in (select my_region_workers()) or can_manage_users());
drop policy if exists plan_rules_write_ins on plan_rules;
drop policy if exists plan_rules_write_upd on plan_rules;
drop policy if exists plan_rules_write_del on plan_rules;
create policy plan_rules_write_ins on plan_rules for insert with check (can_plan(user_id, store_id));
create policy plan_rules_write_upd on plan_rules for update
  using (can_plan(user_id, store_id)) with check (can_plan(user_id, store_id));
create policy plan_rules_write_del on plan_rules for delete using (can_plan(user_id, store_id));

-- A skip belongs to its rule: whoever may plan the rule may record it.
drop policy if exists plan_rule_skips_write_ins on plan_rule_skips;
drop policy if exists plan_rule_skips_write_upd on plan_rule_skips;
drop policy if exists plan_rule_skips_write_del on plan_rule_skips;
create policy plan_rule_skips_write_ins on plan_rule_skips for insert
  with check (can_manage_users() or exists (
    select 1 from plan_rules r where r.id = rule_id and can_plan(r.user_id, r.store_id)));
create policy plan_rule_skips_write_upd on plan_rule_skips for update
  using (can_manage_users() or exists (
    select 1 from plan_rules r where r.id = rule_id and can_plan(r.user_id, r.store_id)))
  with check (can_manage_users() or exists (
    select 1 from plan_rules r where r.id = rule_id and can_plan(r.user_id, r.store_id)));
create policy plan_rule_skips_write_del on plan_rule_skips for delete
  using (can_manage_users() or exists (
    select 1 from plan_rules r where r.id = rule_id and can_plan(r.user_id, r.store_id)));

/**
 * plan_generate from db/23, told to leave alone the rules its caller may not
 * plan. A head sees the rules of their whole branch, and an insert RLS refuses
 * is an error, not a skip — so one rule of a branch member in another region
 * would have failed the head's whole top-up. The nightly run has no caller
 * (current_user_id() is null) and still writes every rule.
 */
create or replace function plan_generate(p_weeks int default 8, p_rule bigint default null)
returns int
language plpgsql as $$
declare n int;
begin
  insert into week_plans (week_start, visit_date, store_id, user_id, rule_id, created_by)
  select w.w, (w.w + r.weekday)::date, r.store_id, r.user_id, r.id, current_user_id()
    from plan_rules r
    cross join (select (week_of() + (i * 7))::date w
                  from generate_series(0, greatest(p_weeks, 1) - 1) i) w
   where r.active
     and (p_rule is null or r.id = p_rule)
     and (current_user_id() is null or can_plan(r.user_id, r.store_id))
     and plan_rule_fires(r.cadence, r.anchor, r.weekday, w.w)
     -- the past is finished work, not a draft
     and (w.w + r.weekday)::date >= current_date
     and not exists (
       select 1 from plan_rule_skips s
        where s.rule_id = r.id and s.visit_date = (w.w + r.weekday)::date)
  -- a day already spoken for stays as it is: a manual task, or another rule
  -- that got there first
  on conflict (store_id, visit_date) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;
