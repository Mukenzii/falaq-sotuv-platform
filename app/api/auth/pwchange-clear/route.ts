import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { me } from '@/lib/auth'
import { PWCHANGE_COOKIE } from '@/lib/cookies'

/**
 * The way out of the "change your password" nag when the database says it is
 * already done.
 *
 * middleware.ts decides from a cookie, because it runs on the edge runtime and
 * cannot reach the database. That cookie can therefore be out of step with the
 * truth — an admin clears the flag, or the password is changed from somewhere
 * else — and when it is, /parol sends the person home, middleware sends them
 * straight back, and they are in a redirect loop with no escape: every other
 * path, /login included, is redirected too.
 *
 * A server component cannot delete a cookie while rendering, so /parol cannot
 * fix it on the way past. It redirects here instead, and this route can.
 *
 * GET, because that is what a redirect issues. It is safe as one: it removes a
 * reminder and nothing else, it is idempotent, and it refuses to act at all
 * while the database still says a new password is owed.
 */
export async function GET() {
  const h = await headers()
  const host = h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  // Built from the Host header, like the logout route: req.url is normalised
  // to the server's own origin, so a phone on the LAN would be sent to its own
  // localhost.
  const to = (path: string) =>
    NextResponse.redirect(host ? `${proto}://${host}${path}` : path, 303)

  const u = await me()
  if (!u) return to('/login')
  // Still owed: the cookie is right and this is not a way around it.
  if (u.mustChangePassword) return to('/parol')

  const res = to('/')
  res.cookies.delete(PWCHANGE_COOKIE)
  return res
}
