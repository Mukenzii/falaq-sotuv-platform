import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asSystem } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { PWCHANGE_COOKIE } from '@/lib/cookies'
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/password'

/**
 * Changing your own password, with the old one as proof.
 *
 * This exists for one situation: an administrator has just handed somebody a
 * temporary password and must_change_password is set. It is not a general
 * account page — there is no "forgot my password" anywhere, by design. Somebody
 * who is locked out asks an admin, who resets it on /admin/users.
 *
 * asSystem, not asUser: password_hash is deliberately never written through the
 * request role, and the check below is what stands in for RLS here.
 */
export async function POST(req: Request) {
  let me: string
  try {
    me = await requireUserId()
  } catch {
    return NextResponse.json({ error: 'Kirish kerak' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const current = typeof body.current === 'string' ? body.current : ''
  const next = typeof body.next === 'string' ? body.next : ''

  const bad = passwordProblem(next)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })
  if (next === current) {
    return NextResponse.json({ error: 'Yangi parol eskisidan farq qilsin' }, { status: 400 })
  }

  const row = await asSystem(async (db) => {
    const r = await db.execute(sql`
      select password_hash, active from users where id = ${me}`)
    return r.rows[0] as { password_hash: string | null; active: boolean } | undefined
  })
  if (!row?.active) return NextResponse.json({ error: 'Kirish kerak' }, { status: 401 })

  if (!(await verifyPassword(current, row.password_hash))) {
    return NextResponse.json({ error: 'Hozirgi parol noto‘g‘ri' }, { status: 403 })
  }

  const hash = await hashPassword(next)
  await asSystem((db) => db.execute(sql`
    update users
       set password_hash = ${hash}, must_change_password = false,
           password_set_at = now(), failed_logins = 0, locked_until = null
     where id = ${me}`))

  const res = NextResponse.json({ ok: true })
  res.cookies.delete(PWCHANGE_COOKIE)
  return res
}
