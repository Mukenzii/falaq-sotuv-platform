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

/**
 * A wrong password costs a minute before the next try. That is slow enough
 * that guessing a password at any useful rate is off the table, and short
 * enough that somebody who simply mistyped waits once and carries on.
 *
 * It replaces the eight-strikes-then-fifteen-minutes rule, which let a guesser
 * have seven free attempts back to back.
 */
const COOLDOWN_SECONDS = 60

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
    // Count the miss and start the wait. Not while already waiting: hammering
    // the form must not keep pushing the deadline further away.
    if (row && !ok && !locked) {
      await asSystem((db) => db.execute(sql`
        update users
           set failed_logins = failed_logins + 1,
               locked_until = now() + (${COOLDOWN_SECONDS} || ' seconds')::interval
         where id = ${row.id}`))
    }
    if (locked) {
      const left = Math.max(1, Math.ceil((new Date(row!.locked_until!).getTime() - Date.now()) / 1000))
      return NextResponse.json(
        { error: `Juda ko‘p urinish. ${left} soniyadan keyin qaytadan urinib ko‘ring.`, retry_after: left },
        { status: 429, headers: { 'retry-after': String(left) } },
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
