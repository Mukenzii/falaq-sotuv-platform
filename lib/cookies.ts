/**
 * The cookie names, and nothing else.
 *
 * middleware.ts needs these and runs on the edge runtime, where node:crypto
 * cannot be imported. Taking them from lib/session.ts pulled its HMAC helpers
 * into the edge bundle and broke the whole build with "Reading from
 * node:crypto is not handled" — the same trap lib/sheetsSync.ts and the old
 * Telegram poller both have comments about. A module with no imports cannot
 * drag anything in with it.
 */
export const SESSION_COOKIE = 'falaq_session'

/**
 * Set when somebody signs in on a password an administrator chose for them,
 * and cleared when they pick their own. middleware.ts reads it — and only it —
 * to steer them to /parol, because the database is out of reach from there.
 *
 * Nothing is protected by this cookie, so it is not signed: the worst somebody
 * can do by deleting it is keep using a password they already know.
 */
export const PWCHANGE_COOKIE = 'falaq_pwchange'
