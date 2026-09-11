-- Nobody types a telegram_id by hand any more.
--
-- An id is not something a person can look up about themselves, so asking an
-- admin to enter one was asking them to get it from somewhere that does not
-- exist. Instead an unknown account that messages the bot leaves a request
-- here, carrying the id Telegram already told us, and the admin approves it.

create table if not exists join_requests (
  telegram_id  bigint primary key,
  username     text,
  display_name text not null,
  created_at   timestamptz not null default now(),
  seen_at      timestamptz
);

alter table join_requests enable row level security;
alter table join_requests force  row level security;

-- The bot writes these through asSystem, which bypasses RLS. Through a request
-- they are visible only to whoever may create the user that answers them.
drop policy if exists jr_read on join_requests;
create policy jr_read on join_requests for select using (can_manage_users());
drop policy if exists jr_delete on join_requests;
create policy jr_delete on join_requests for delete using (can_manage_users());
drop policy if exists jr_update on join_requests;
create policy jr_update on join_requests for update
  using (can_manage_users()) with check (can_manage_users());

-- Assigning a store to someone is user management, not visit data, and s_write
-- already gates it on can_manage_users(). Nothing further needed here; this
-- comment exists so the next reader does not go looking for a missing policy.
