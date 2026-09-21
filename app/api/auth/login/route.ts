import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asSystem } from '@/lib/db'
import { setSession } from '@/lib/session'
import { PWCHANGE_COOKIE } from '@/lib/cookies'
import { DUMMY_HASH, normalizeUsername, verifyPassword } from '@/lib/password'

/**
 * The only way in.
 *
 * Runs through asSystem because finding out who is signing in has to happen
 * before there is a session for RLS to key on — the same reason the old
 * Telegram lookup did — and because password_hash is never handed to the
 * request role.
 *
 * One message for every failure. "Bunday login yo'q" would turn this form into
 * a way of asking whether somebody works here.
 */
const WRONG = 'Login yoki parol noto‘g‘ri'
const MAX_FAILS = 8
const LOCK_MINUTES = 15

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const login = normalizeUsername(body.login)
  const password = typeof body.password === 'string' ? body.password : ''

  if (!login || !password) {
    return NextResponse.json({ error: 'Login va parolni kiriting' }, { status: 400 })
  }

  const row = await asSystem(async (db) => {
    const r = await db.execute(sql`
      select id, password_hash, active, must_change_password, locked_until, failed_logins
        from users
       where lower(username) = ${login}`)
    return r.rows[0] as {
      id: string; password_hash: string | null; active: boolean
      must_change_password: boolean; locked_until: string | null; failed_logins: number
    } | undefined
  })

  // A locked account still pays for a derivation below, so guessing cannot
  // tell "locked" from "wrong" by how long the answer takes.
  const locked = !!row?.locked_until && new Date(row.locked_until) > new Date()

  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH)

  if (!row || !ok || !row.active || locked) {
    if (row && !ok) {
      // Count the miss, and stop counting once the door is already shut.
      await asSystem((db) => db.execute(sql`
        update users
           set failed_logins = failed_logins + 1,
               locked_until = case when failed_logins + 1 >= ${MAX_FAILS}
                                   then now() + (${LOCK_MINUTES} || ' minutes')::interval
                                   else locked_until end
         where id = ${row.id}`))
    }
    if (locked) {
      return NextResponse.json(
        { error: `Hisob vaqtincha bloklandi. ${LOCK_MINUTES} daqiqadan keyin urinib ko‘ring.` },
        { status: 429 },
      )
    }
    if (row && !row.active && ok) {
      return NextResponse.json({ error: 'Hisobingiz faolsizlantirilgan. Rahbaringizga murojaat qiling.' },
        { status: 403 })
    }
    return NextResponse.json({ error: WRONG }, { status: 401 })
  }

  await asSystem((db) => db.execute(sql`
    update users set failed_logins = 0, locked_until = null where id = ${row.id}`))

  await setSession(row.id)

  const res = NextResponse.json({ ok: true, next: row.must_change_password ? '/parol' : '/' })
  if (row.must_change_password) {
    res.cookies.set(PWCHANGE_COOKIE, '1', { httpOnly: true, sameSite: 'lax', path: '/' })
  } else {
    res.cookies.delete(PWCHANGE_COOKIE)
  }
  return res
}
