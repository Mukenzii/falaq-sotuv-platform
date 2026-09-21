import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { PWCHANGE_COOKIE } from '@/lib/cookies'
import { SESSION_COOKIE } from '@/lib/session'

/**
 * POST, not GET: a link would be followed by a prefetch or a crawler and log
 * people out by accident. The header posts a real form, so this works with no
 * JavaScript — which matters on a phone with a half-loaded page in a shop.
 */
export async function POST() {
  const h = await headers()
  const host = h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'

  // Build the redirect from the Host header: req.url is normalised to the
  // server's own origin, so a phone on the LAN would be sent to its own
  // localhost. Same trap the MinIO presign and the old dev login both hit.
  const res = NextResponse.redirect(host ? `${proto}://${host}/login` : '/login', 303)
  res.cookies.delete(SESSION_COOKIE)
  res.cookies.delete(PWCHANGE_COOKIE)
  return res
}
