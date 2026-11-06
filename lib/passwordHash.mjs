/**
 * Hashing a password, in plain ESM so that it runs anywhere node does.
 *
 * This is deliberately not TypeScript. scripts/set-password.mjs has to run
 * inside the production image, which is a Next standalone build: it holds
 * server.js, the traced node_modules and nothing else — no tsx, no .ts sources.
 * A script that imported a .ts module could only ever run from a checkout,
 * which is exactly the bootstrap case where there is no checkout to run from.
 *
 * lib/password.ts re-exports all of this, so application code is unaffected and
 * there is still one implementation of the hash format.
 *
 * scrypt comes from node:crypto — no dependency, and the one memory-hard KDF in
 * the standard library. The cost parameters live in the hash itself, so raising
 * them later leaves every existing password verifiable.
 *
 * N=16384, r=8 needs 128*N*r = 16MB per verification, inside node's 32MB
 * default maxmem. Roughly 60ms on the server, which is the point.
 */
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)

const N = 16384
const R = 8
const P = 1
const KEYLEN = 32

/**
 * @param {string} plain
 * @returns {Promise<string>}
 */
export async function hashPassword(plain) {
  const salt = randomBytes(16)
  const key = await scrypt(plain.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

/**
 * Constant-ish time: the comparison is timingSafeEqual, and a caller with no
 * user to check still pays for a real derivation (see DUMMY_HASH), so a wrong
 * username and a wrong password take the same wall time.
 *
 * @param {string} plain
 * @param {string | null} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plain, stored) {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, key] = parts
  try {
    const want = Buffer.from(key, 'base64url')
    const got = await scrypt(plain.normalize('NFKC'), Buffer.from(salt, 'base64url'), want.length,
      { N: Number(n), r: Number(r), p: Number(p) })
    return got.length === want.length && timingSafeEqual(got, want)
  } catch {
    return false
  }
}

/**
 * A hash of a password nobody holds. Verifying against it when the username is
 * unknown keeps a failed sign-in the same cost as a successful one, so the
 * login form cannot be used to find out who has an account.
 */
export const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'qcVITkwx2kfuYQeSbIw8n1HeUUPuu-KO_xBUQjy4Mq4'

/** Ten characters, no 0/O/1/l/I: these get read aloud and copied off paper. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY23456789'

/**
 * @param {number} [len]
 * @returns {string}
 */
export function generatePassword(len = 10) {
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}
