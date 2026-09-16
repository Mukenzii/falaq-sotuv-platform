-- Signing in a second time.
--
-- The browser mints a nonce and the phone carries it to the bot as
-- /start <nonce>. That works exactly once per person: Telegram only delivers
-- the deep-link payload while the chat with the bot is new. Open the same link
-- with the conversation already there and the client sends a bare /start, or
-- nothing at all — so the nonce is never claimed, the login page waits out its
-- ten minutes and says the link expired, and the bot answers with advice to
-- press the button they just pressed.
--
-- The fix reverses the direction for everyone already on the list: the bot
-- hands THEM a one-time link. It is bound to their telegram_id rather than to
-- a browser, because it is delivered inside a chat only that account can read
-- — which is also what makes it work on whichever device they are holding,
-- phone or laptop, without disturbing the other.

alter table login_tokens add column if not exists bot_issued boolean not null default false;

comment on column login_tokens.bot_issued is
  'Minted by the bot for a known user and sent to them in chat. Consumed by /kirish; '
  'never accepted by the browser poll flow, which owns the cookie-bound nonces.';
