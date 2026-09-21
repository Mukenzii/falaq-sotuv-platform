/**
 * Set somebody's login and password from the command line.
 *
 * This exists for exactly one situation that the admin panel cannot solve:
 * the FIRST account. Accounts are created on /admin/users, which you have to
 * be signed in to reach, which needs an account. Something outside the web app
 * has to break that circle, and it is this.
 *
 *   node scripts/set-password.mjs komil 'yangi-parol'
 *       give the account whose login is already "komil" a new password
 *
 *   node scripts/set-password.mjs komil 'yangi-parol' Komil
 *       find the person called Komil, give them the login "komil" and that
 *       password — this is the form to use on a database that predates logins,
 *       where everybody still has a telegram_id and no username
 *
 *   node scripts/set-password.mjs --list
 *       who exists, and whether they can sign in
 *
 * Plain node, not tsx, and it imports no TypeScript. That is the whole point:
 * this has to run inside the production image, which is a Next standalone
 * build — server.js, the traced node_modules and nothing else. pg is in there
 * because lib/db.ts uses it. An earlier version imported ../lib/password.ts and
 * could therefore only run from a checkout, which is precisely what the first
 * account has no way to get at.
 *
 * Add --temporary to make them choose a new password on first sign-in. The
 * first direktor is not forced to, because there is nobody to reset it for
 * them if they get stuck.
 *
 * Connects as the owner (DATABASE_URL_OWNER), which bypasses RLS — the same
 * connection the app uses to write a password.
 */
// Only when there is one to read. In the container the environment comes from
// compose, and dotenv is a devDependency that is not installed there.
try { await import('dotenv/config') } catch { /* no .env: compose supplies it */ }

import { Pool } from 'pg'
import { hashPassword } from '../lib/passwordHash.mjs'
import { normalizeUsername, passwordProblem, usernameProblem } from '../lib/passwordRules.mjs'

const argv = process.argv.slice(2)
const temporary = argv.includes('--temporary')
const list = argv.includes('--list')
const [login, password, ...nameParts] = argv.filter((a) => !a.startsWith('--'))
const name = nameParts.join(' ')

const url = process.env.DATABASE_URL_OWNER
if (!url) {
  console.error('\n  DATABASE_URL_OWNER is not set. Run this inside the app container,\n'
    + '  or point it at the database yourself.\n')
  process.exit(1)
}
const pool = new Pool({ connectionString: url })
const q = (text, values) => pool.query(text, values)

function die(msg) {
  console.error(`\n  ${msg}\n`)
  process.exitCode = 1
}

if (list) {
  const { rows } = await q(`
    select full_name, username, role, active, password_hash is not null as has_password,
           must_change_password
      from users order by role, full_name`)
  console.log()
  for (const r of rows) {
    const state = !r.active ? 'faolsiz'
      : !r.username ? 'LOGIN YO‘Q'
      : !r.has_password ? 'PAROL YO‘Q'
      : r.must_change_password ? 'vaqtinchalik parol'
      : 'kira oladi'
    console.log(`  ${(r.username ?? '—').padEnd(20)} ${r.full_name.padEnd(24)} ${r.role.padEnd(16)} ${state}`)
  }
  console.log()
  await pool.end()
  process.exit(0)
}

if (!login || !password) {
  console.error(`
  Usage:
    node scripts/set-password.mjs <login> <parol> [ism] [--temporary]
    node scripts/set-password.mjs --list
`)
  process.exit(1)
}

const wantLogin = normalizeUsername(login)
const badLogin = usernameProblem(wantLogin)
const badPassword = passwordProblem(password)
if (badLogin || badPassword) {
  die(badLogin ?? badPassword)
  await pool.end()
  process.exit(1)
}

// Find the row first, so a typo is a message rather than a silent no-op.
const found = name
  ? await q('select id, full_name, username from users where full_name ilike $1', [name])
  : await q('select id, full_name, username from users where lower(username) = $1', [wantLogin])

if (found.rows.length === 0) {
  die(name
    ? `"${name}" degan xodim topilmadi. Mavjudlarini ko‘rish: --list`
    : `"${wantLogin}" degan login topilmadi. Ism bilan izlash: set-password.mjs ${wantLogin} '<parol>' '<Ism>'`)
  await pool.end()
  process.exit(1)
}
if (found.rows.length > 1) {
  die(`"${name}" bir nechta xodimga to‘g‘ri keldi: ${found.rows.map((r) => r.full_name).join(', ')}`)
  await pool.end()
  process.exit(1)
}

const user = found.rows[0]
const hash = await hashPassword(password)

try {
  await q(`
    update users
       set username = $2, password_hash = $3, must_change_password = $4,
           password_set_at = now(), failed_logins = 0, locked_until = null, active = true
     where id = $1`, [user.id, wantLogin, hash, temporary])
} catch (e) {
  // 23505: somebody else already holds that login.
  die(e.code === '23505' ? `"${wantLogin}" logini band` : e.message)
  await pool.end()
  process.exit(1)
}

console.log(`
  ${user.full_name}: login "${wantLogin}", parol o‘rnatildi${temporary ? ' (birinchi kirishda o‘zgartiradi)' : ''}.
  /login sahifasida shu login va parol bilan kiring.
`)
await pool.end()
