-- Repeating plans.
--
-- Until now every task was placed by hand: an admin picked shops, a person and
-- a day, and that was one week's work. Most shops are not like that — one is a
-- Thursday shop every fortnight, another wants a visit once a month — so the
-- same clicking was repeated every Monday.
--
-- A rule is (shop, person, weekday, cadence). It does not replace the board:
-- it WRITES tasks onto it, up to a horizon, and from then on those tasks are
-- ordinary rows. Everything downstream — v_week_plan, bajarildi/kechikdi, the
-- manager's dropdown, the delete path — keeps working without knowing that
-- rules exist.
--
-- Two promises the generator keeps, which is most of the design:
--   * it never writes into the past (visit_date >= current_date), so a week
--     that has been worked is never re-shuffled;
--   * a task an admin moved or deleted stays moved or deleted. Removing a
--     generated task records a skip, and the generator honours it forever.

create table if not exists plan_rules (
  id         bigserial primary key,
  store_id   bigint not null references stores(id) on delete cascade,
  user_id    uuid   not null references users(id)  on delete cascade,
  -- 0 = Monday, matching week_plans.visit_date - week_start
  weekday    int    not null check (weekday between 0 and 6),
  cadence    text   not null check (cadence in
               ('haftada', 'ikki_hafta', 'juft', 'toq', 'uch_hafta', 'tort_hafta', 'oy')),
  -- the Monday the rhythm counts from; "every two weeks" is meaningless without it
  anchor     date   not null default week_of(),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null,
  -- one shop, one weekday, one owner: the same pair twice is an edit, not a
  -- second rule. Different weekdays are different rules, which is how a shop
  -- gets Monday AND Thursday.
  unique (store_id, weekday, user_id)
);
create index if not exists plan_rules_user_idx on plan_rules(user_id) where active;

-- A generated task that an admin then moved or deleted. Without this the next
-- run would put it straight back, and the admin's decision would be a
-- suggestion rather than a decision.
create table if not exists plan_rule_skips (
  rule_id    bigint not null references plan_rules(id) on delete cascade,
  visit_date date   not null,
  primary key (rule_id, visit_date)
);

-- Which rule put this task here, if any. Null means a person did.
alter table week_plans add column if not exists rule_id bigint
  references plan_rules(id) on delete set null;

alter table plan_rules      enable row level security;
alter table plan_rules      force  row level security;
alter table plan_rule_skips enable row level security;
alter table plan_rule_skips force  row level security;

-- Same shape as wp_read/wp_write: you see your own rhythm and your team's,
-- and only an admin writes one.
drop policy if exists pr_read on plan_rules;
create policy pr_read on plan_rules for select
  using (user_id in (select my_team()) or can_manage_users());
drop policy if exists pr_write on plan_rules;
create policy pr_write on plan_rules for all
  using (can_manage_users()) with check (can_manage_users());

drop policy if exists prs_read on plan_rule_skips;
create policy prs_read on plan_rule_skips for select using (current_user_id() is not null);
drop policy if exists prs_write on plan_rule_skips;
create policy prs_write on plan_rule_skips for all
  using (can_manage_users()) with check (can_manage_users());

grant select, insert, update, delete on plan_rules      to falaq_app;
grant select, insert, update, delete on plan_rule_skips to falaq_app;
grant usage, select on sequence plan_rules_id_seq to falaq_app;

/**
 * Does a rule fire in the week beginning w?
 *
 * The counted cadences measure from the rule's own anchor, so "every two
 * weeks" means every two weeks from when it was set, not from an arbitrary
 * epoch. The even/odd ones are absolute: they follow the ISO week number, so
 * two shops on "juft" are always on the same weeks as each other — which is
 * the whole reason that option exists on a route sheet.
 *
 * 'oy' is the flexible month: the first matching weekday of each calendar
 * month. Any day in the month satisfies "once a month", and the first is the
 * one that leaves room to catch up if it is missed.
 */
create or replace function plan_rule_fires(p_cadence text, p_anchor date, p_weekday int, w date)
returns boolean
language sql immutable as $$
  select case
    when w < p_anchor then false
    when p_cadence = 'haftada'    then true
    when p_cadence = 'ikki_hafta' then ((w - p_anchor) / 7) % 2 = 0
    when p_cadence = 'uch_hafta'  then ((w - p_anchor) / 7) % 3 = 0
    when p_cadence = 'tort_hafta' then ((w - p_anchor) / 7) % 4 = 0
    when p_cadence = 'juft'       then extract(week from w)::int % 2 = 0
    when p_cadence = 'toq'        then extract(week from w)::int % 2 = 1
    when p_cadence = 'oy'         then extract(day from (w + p_weekday))::int <= 7
    else false
  end
$$;

/**
 * Lay the rules onto the board for the next p_weeks weeks. Safe to run as
 * often as you like: it only ever adds.
 *
 * Runs as the caller, so RLS decides — week_plans is admin-write, and a
 * manager calling this writes nothing.
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

comment on function plan_generate is
  'Writes rule tasks into week_plans up to a horizon. Adds only; never rewrites.';

-- rule_id on the board, so a card can say it came from a rhythm. Appended to
-- the end of the column list, which is what create or replace allows.
create or replace view v_week_plan with (security_invoker = true) as
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
       end as holat,
       t.rule_id
  from t
  join users  u on u.id = t.user_id
  join stores s on s.id = t.store_id
  cross join lateral (
    select plan_visit_between(t.store_id, t.user_id, t.win_from, t.win_to) as first_at
  ) f;
