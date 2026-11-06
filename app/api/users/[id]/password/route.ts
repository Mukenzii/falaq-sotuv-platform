import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asSystem } from '@/lib/db'
import { Forbidden, Unauthorized, requireAdmin } from '@/lib/auth'
import { generatePassword, hashPassword, passwordProblem } from '@/lib/password'

/**
 * An administrator resetting somebody's password.
 *
 * The new password is returned once, in this response, and is never readable
 * again — only its scrypt hash is stored. The admin reads it out to the person,
 * who is made to replace it the moment they sign in.
 *
 * Unlike the rest of /api/users this does NOT lean on RLS: password_hash is
 * written through asSystem, which bypasses policies, so the role check has to
 * be explicit and has to come first.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
  } catch (e) {
    if (e instanceof Unauthorized) return NextResponse.json({ error: 'Kirish kerak' }, { status: 401 })
    if (e instanceof Forbidden) return NextResponse.json({ error: 'Ruxsat yo‘q' }, { status: 403 })
    throw e
  }

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  // An admin may type the replacement instead of taking the generated one —
  // useful when it has to be read down a bad phone line.
  const body = await req.json().catch(() => ({}))
  const chosen = typeof body.password === 'string' && body.password ? body.password : null
  if (chosen) {
    const bad = passwordProblem(chosen)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
  }
  const password = chosen ?? generatePassword()
  const hash = await hashPassword(password)

  // The guard is inside the UPDATE, not after it: checking afterwards would
  // mean the password had already been changed on an account nobody can use.
  const row = await asSystem(async (db) => {
    const r = await db.execute(sql`
      update users
         set password_hash = ${hash}, must_change_password = true,
             password_set_at = now(), failed_logins = 0, locked_until = null
       where id = ${id} and username is not null
      returning full_name, username`)
    if (r.rows.length) return r.rows[0] as { full_name: string; username: string }
    const exists = await db.execute(sql`select 1 from users where id = ${id}`)
    return exists.rows.length ? 'no-login' as const : null
  })
  if (!row) return NextResponse.json({ error: 'Topilmadi' }, { status: 404 })
  if (row === 'no-login') {
    return NextResponse.json(
      { error: 'Avval bu xodimga login bering, keyin parol o‘rnating' }, { status: 409 })
  }

  return NextResponse.json({ ok: true, username: row.username, full_name: row.full_name, password })
}
