-- A shop on your weekly plan is yours to file against.
--
-- There were two ways to give somebody a shop and they did not agree with each
-- other. /admin/reja writes week_plans.user_id — who is due to visit what, and
-- the number the home screen counts. stores.owner_id (db/25) is what the
-- new-visit form offered and what v_insert accepted. Nothing kept them in step,
-- so a manager could open the app, be told 104 shops were waiting, and find an
-- empty dropdown and the words "sizga hali do'kon biriktirilmagan".
--
-- The plan is the one people actually fill in, so it decides. owner_id still
-- counts — assigning a whole region in one press is worth keeping — but it is
-- no longer the only way in.

create or replace function store_is_mine(p_store_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from stores s
     where s.id = p_store_id and s.owner_id = current_user_id())
      or exists (
    select 1 from week_plans p
     where p.store_id = p_store_id and p.user_id = current_user_id());
$$;

comment on function store_is_mine is
  'Whether the signed-in person may file a visit against this shop: it is '
  'theirs (stores.owner_id) or it is on their weekly plan (week_plans). '
  'security definer because week_plans is itself behind RLS.';

grant execute on function store_is_mine(bigint) to falaq_app;

drop policy if exists v_insert on visits;
create policy v_insert on visits for insert
  with check (manager_id = current_user_id() and store_is_mine(store_id));
