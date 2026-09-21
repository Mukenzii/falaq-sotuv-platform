-- Signing in with a login and a password, and nothing else.
--
-- Telegram is gone as an identity. It was convenient (nobody types an id, the
-- bot proves who pressed START) but it made three things impossible: an
-- account for somebody without Telegram, an admin handing out access on the
-- spot, and taking access away without asking Telegram's permission. Accounts
-- are now created by an administrator on /admin/users, and that is the only
-- way one comes into existence.
--
-- telegram_id stays as a nullable note. Deleting the column would throw away
-- the record of which Telegram account each of these people used to be, and
-- nothing reads it any more, so there is no reason to.
--
-- On a fresh database db/01 already creates these columns; everything here is
-- written so that running it twice, or after 01, changes nothing.

alter table users
  add column if not exists username             text,
  add column if not exists password_hash        text,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_set_at      timestamptz,
  add column if not exists failed_logins        integer not null default 0,
  add column if not exists locked_until         timestamptz;

alter table users alter column telegram_id drop not null;

-- Case never decides who you are: "Komil" and "komil" are one account. The app
-- lowercases before it writes, and this index is what makes that a rule rather
-- than a habit.
create unique index if not exists users_username_key on users (lower(username));

alter table users drop constraint if exists users_username_shape;
alter table users add constraint users_username_shape
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

comment on column users.username is
  'The login. Lowercase; unique through users_username_key. NULL means the '
  'account exists but cannot sign in yet — an admin has not given it one.';
comment on column users.password_hash is
  'scrypt, lib/password.ts. NULL means no password has been set and every '
  'sign-in attempt fails. Written only through asSystem, never by falaq_app.';
comment on column users.locked_until is
  'Set by the login route after repeated failures. Cleared on success.';

-- u_update lets a person edit their own row, which is right for their name and
-- phone and catastrophic for everything else: without this, any manager could
-- PATCH their own role to direktor, or their own username onto someone else's
-- login. RLS has no column granularity, so the rule lives in a trigger.
--
-- An owner connection (asSystem, current_user_id() unset) is trusted: it is
-- reached only from code that has already checked who is asking, and it is how
-- a password is written at all.
create or replace function guard_self_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then return new; end if;
  if can_manage_users() then return new; end if;
  if new.id <> current_user_id() then return new; end if;

  if (new.role, new.active, new.parent_id, new.username, new.password_hash,
      new.must_change_password, new.telegram_id, new.region_code)
     is distinct from
     (old.role, old.active, old.parent_id, old.username, old.password_hash,
      old.must_change_password, old.telegram_id, old.region_code) then
    raise exception 'O''z hisobingizda faqat ism va telefonni o''zgartira olasiz';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_self_update on users;
create trigger trg_guard_self_update
  before update on users
  for each row execute function guard_self_update();

-- The Telegram machinery, removed rather than left switched off: a login path
-- that still exists is a login path. db/11, db/12 and db/24 created these and
-- have been deleted alongside them.
drop table if exists login_tokens;
drop table if exists telegram_cursor;
drop table if exists join_requests;
