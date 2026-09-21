import { NextResponse, type NextRequest } from 'next/server'
import { PWCHANGE_COOKIE, SESSION_COOKIE } from '@/lib/cookies'

/**
 * Somebody signing in on a password an administrator chose for them goes to
 * /parol and stays there until they pick their own.
 *
 * Middleware runs on the edge runtime, where pg cannot be imported, so this
 * decides from a cookie the login route set rather than from the database. The
 * database is still the authority — /api/auth/password is what clears
 * must_change_password — and this only steers the browser.
 */
export function middleware(req: NextRequest) {
  const c = req.cookies
  if (!c.get(PWCHANGE_COOKIE) || !c.get(SESSION_COOKIE)) return NextResponse.next()

  const { pathname } = req.nextUrl
  // /parol itself, the call that ends the nag, and the way out, all have to
  // stay reachable — otherwise this is a redirect loop with no exit.
  if (pathname === '/parol' || pathname.startsWith('/api/auth/')) return NextResponse.next()

  // An API call from a half-updated page should hear why, not be handed HTML.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Avval parolni o‘zgartiring' }, { status: 409 })
  }

  const to = req.nextUrl.clone()
  to.pathname = '/parol'
  to.search = ''
  return NextResponse.redirect(to)
}

export const config = {
  // Everything but Next's own assets and the files served straight off disk.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico|css|js)$).*)'],
}
