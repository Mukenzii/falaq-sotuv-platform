import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies, headers } from 'next/headers'

export const SESSION_COOKIE = 'falaq_session'
const COOKIE = SESSION_COOKIE
const MAX_AGE = 60 * 60 * 24 * 30

function sign(value: string): string {
  const mac = createHmac('sha256', process.env.SESSION_SECRET!).update(value).digest('base64url')
  return `${value}.${mac}`
}

function unsign(signed: string | undefined): string | null {
  if (!signed) return null
  const i = signed.lastIndexOf('.')
  if (i < 0) return null
  const value = signed.slice(0, i)
  const a = Buffer.from(signed.slice(i + 1))
  const b = Buffer.from(createHmac('sha256', process.env.SESSION_SECRET!).update(value).digest('base64url'))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return value
}

/**
 * Whether to mark the session cookie Secure.
 *
 * This used to be `NODE_ENV === 'production'`, which broke the moment the app
 * was deployed on a plain http:// address: a browser silently DISCARDS a
 * Secure cookie sent over http, so signing in appeared to do nothing. Decide
 * from the actual request instead — nginx passes X-Forwarded-Proto — and let
 * COOKIE_SECURE force it on for a deployment that terminates TLS elsewhere in
 * a way we cannot see.
 */
export async function cookieSecure(): Promise<boolean> {
  const forced = process.env.COOKIE_SECURE
  if (forced === 'true') return true
  if (forced === 'false') return false
  const proto = (await headers()).get('x-forwarded-proto')
  return proto ? proto.split(',')[0].trim() === 'https' : false
}

export async function setSession(userId: string) {
  ;(await cookies()).set(COOKIE, sign(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: await cookieSecure(),
    path: '/',
    maxAge: MAX_AGE,
  })
}

export async function clearSession() {
  ;(await cookies()).delete(COOKIE)
}

export async function currentUserId(): Promise<string | null> {
  return unsign((await cookies()).get(COOKIE)?.value)
}

/** Throws in route handlers that must not run anonymously. */
export async function requireUserId(): Promise<string> {
  const id = await currentUserId()
  if (!id) throw new Error('unauthorized')
  return id
}
