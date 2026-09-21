/**
 * The rules about logins and passwords, and nothing that hashes one.
 *
 * Separate from lib/password.ts because the admin screen and the change-password
 * screen are client components: importing the module that pulls in node:crypto
 * would drag scrypt into the browser bundle and break the build.
 */

/** Mirrors the users_username_shape check in db/01 and db/29. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/
export const MIN_PASSWORD = 8

/** Case never decides who you are, and neither does a stray space. */
export function normalizeUsername(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
}

/** null when it is fine, otherwise the message to show. */
export function usernameProblem(login: string): string | null {
  if (!login) return 'Login kiritilmagan'
  if (!USERNAME_RE.test(login)) {
    return 'Login 3–32 belgidan iborat bo‘lsin: kichik lotin harflari, raqamlar va . _ -'
  }
  return null
}

export function passwordProblem(plain: string): string | null {
  if (!plain) return 'Parol kiritilmagan'
  if (plain.length < MIN_PASSWORD) return `Parol kamida ${MIN_PASSWORD} ta belgidan iborat bo‘lsin`
  if (plain.length > 200) return 'Parol juda uzun'
  return null
}

/**
 * A login suggested from somebody's name: "Sardor Umarov" -> "sardor.umarov".
 * Only a starting point — the admin can type anything, and the database has
 * the last word on whether it is free.
 */
export function suggestUsername(fullName: string): string {
  const FOLD: Record<string, string> = {
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
