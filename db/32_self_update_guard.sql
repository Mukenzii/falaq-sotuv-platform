-- Your own row: your name and your phone, and nothing else.
--
-- u_update (db/02) lets a person update their own row, and RLS has no column
-- granularity, so until now that meant every column: any sotuv_manager could
-- PATCH /api/users/<own id> with {"role":"direktor"} and become one. The same
-- hole moved you out from under your boss (parent_id), into another region
-- (region_code), or onto someone else's Telegram account (telegram_id, which is
-- the login itself).
--
-- The rule is a list of what may change, not of what may not. A column added
-- later is protected until someone decides otherwise, instead of being open
-- until someone remembers.
--
-- An owner connection (asSystem, current_user_id() unset) is trusted. Login
-- reaches users that way, before any session exists, and writes
-- telegram_username and a missing full_name. falaq_app with no user set cannot
-- update anything anyway: u_update matches no row.
--
-- 42501 is the code RLS itself uses for "not allowed", so the routes already
-- treat it as 403. A plain RAISE would be P0001, which the users route reports
-- as guard_last_direktor's 409.
--
-- This replaces guard_self_update from db/29, which listed the columns to
-- protect and raised a plain exception. Everything it protected is covered here,
-- so the old trigger is removed rather than left running beside this one.

create or replace function guard_own_row() returns trigger
language plpgsql as $$
begin
  if current_user_id() is null or can_manage_users() then
    return new;
  end if;

  if to_jsonb(new) - array['full_name', 'phone']
     is distinct from
     to_jsonb(old) - array['full_name', 'phone'] then
    raise exception 'O''z hisobingizda faqat ism va telefonni o''zgartira olasiz'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_self_update on users;
drop function if exists guard_self_update();

drop trigger if exists trg_guard_own_row on users;
create trigger trg_guard_own_row
  before update on users
  for each row execute function guard_own_row();
