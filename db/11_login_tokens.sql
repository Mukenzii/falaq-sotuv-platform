-- Login through the bot instead of the Telegram Login Widget.
--
-- The widget only renders on the single domain registered with @BotFather
-- /setdomain, which makes it useless on a LAN address or a tunnel whose name
-- changes every restart. A bot deep link has no such restriction: the browser
-- mints a nonce, the phone sends it to the bot as /start <nonce>, and the bot
-- update tells us which telegram_id pressed it.

create table if not exists login_tokens (
  nonce       text primary key,
  created_at  timestamptz not null default now(),
  telegram_id bigint,                 -- filled in when the bot sees the /start
  claimed_at  timestamptz,
  consumed_at timestamptz             -- set once a session has been handed out
);
create index if not exists login_tokens_created_idx on login_tokens(created_at);

-- getUpdates is a cursor, not a query: an update is delivered once and is gone
-- as soon as a later offset is requested. The cursor therefore has to survive a
-- dev-server reload, so it lives here rather than in module memory.
create table if not exists telegram_cursor (
  id        boolean primary key default true check (id),
  update_id bigint not null default 0
);
insert into telegram_cursor (id, update_id) values (true, 0) on conflict do nothing;

-- A lease, not a session lock. Only one drain may talk to getUpdates at a time
-- (Telegram is single-consumer), but a drain spans several HTTP calls, and a
-- pg advisory lock would mean holding a pooled owner connection across all of
-- them — two of those at once exhausts the pool and every query behind them
-- hangs. A timestamp in a row survives the connection being handed back.
alter table telegram_cursor add column if not exists locked_until timestamptz;

-- These hold half-finished logins, so the request role has no business reading
-- them; only asSystem (falaq_owner) touches them. The blanket default privilege
-- in 00_roles.sql would otherwise have granted falaq_app full access.
revoke all on login_tokens, telegram_cursor from falaq_app;
