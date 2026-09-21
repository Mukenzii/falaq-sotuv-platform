import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number },
) => Promise<Buffer>

/**
 * Passwords are hashed with scrypt from node:crypto — no new dependency, and
 * it is the one memory-hard KDF already in the standard library. The cost
 * parameters are stored in the hash itself, so raising them later leaves every
 * existing password verifiable.
 *
 * N=16384, r=8 needs 128*N*r = 16MB per verification, inside node's 32MB
 * default maxmem. Roughly 60ms on the server, which is the point.
 */
const N = 16384
const R = 8
const P = 1
const KEYLEN = 32
const b64 = (b: Buffer) => b.toString('base64url')

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(plain.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${b64(salt)}$${b64(key)}`
}

/**
 * Constant-ish time: the comparison is timingSafeEqual, and a caller with no
 * user to check still pays for a real derivation (see DUMMY_HASH), so a wrong
 * username and a wrong password take the same wall time.
 */
export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, key] = parts
  let want: Buffer
  try {
    want = Buffer.from(key, 'base64url')
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
export function generatePassword(len = 10): string {
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

/**
 * The rules themselves live in lib/password.shared.ts, which the client
 * components import — this module cannot be, because of node:crypto above.
 */
export * from './password.shared'
