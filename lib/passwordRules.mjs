/**
 * The rules about logins and passwords, and nothing that hashes one.
 *
 * Plain ESM for the same reason as lib/passwordHash.mjs: scripts/set-password.mjs
 * runs inside an image that has no TypeScript in it. It is also what the client
 * components import (through lib/password.shared.ts), which is why nothing here
 * touches node:crypto — that would drag scrypt into the browser bundle.
 */

/** Mirrors the users_username_shape check in db/01 and db/29. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/
export const MIN_PASSWORD = 8

/**
 * Case never decides who you are, and neither does a stray space.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeUsername(raw) {
  return String(raw ?? '').trim().toLowerCase()
}

/**
 * null when it is fine, otherwise the message to show.
 * @param {string} login
 * @returns {string | null}
 */
export function usernameProblem(login) {
  if (!login) return 'Login kiritilmagan'
  if (!USERNAME_RE.test(login)) {
    return 'Login 3–32 belgidan iborat bo‘lsin: kichik lotin harflari, raqamlar va . _ -'
  }
  return null
}

/**
 * @param {string} plain
 * @returns {string | null}
 */
export function passwordProblem(plain) {
  if (!plain) return 'Parol kiritilmagan'
  if (plain.length < MIN_PASSWORD) return `Parol kamida ${MIN_PASSWORD} ta belgidan iborat bo‘lsin`
  if (plain.length > 200) return 'Parol juda uzun'
  return null
}

/**
 * A login suggested from somebody's name: "Sardor Umarov" -> "sardor.umarov".
 * Only a starting point — the admin can type anything, and the database has
 * the last word on whether it is free.
 *
 * @param {string} fullName
 * @returns {string}
 */
export function suggestUsername(fullName) {
  /** @type {Record<string, string>} */
  const FOLD = {
    'ʻ': '', '‘': '', '’': '', "'": '', 'ў': 'o', 'ғ': 'g', 'қ': 'q', 'ҳ': 'h',
    'ч': 'ch', 'ш': 'sh', 'я': 'ya', 'ю': 'yu', 'ё': 'yo', 'ж': 'j', 'ц': 's',
  }
  const base = fullName
    .toLowerCase()
    .replace(/./g, (c) => (c in FOLD ? FOLD[c] : c))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 32)
  return USERNAME_RE.test(base) ? base : ''
}
