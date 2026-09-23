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
 * THROTTLING, and the rule it now obeys: the right password always gets you in.
 *
 * The previous rule shut the account for sixty seconds on any wrong password
 * and refused everything for that minute — including the very next attempt,
 * with the right password typed in. One typo cost a manager standing in a shop
 * a full minute, and it was doing that several times a day. Worse, the lock
 * hung on the username alone, so anyone who knew one could keep that person
 * out for good by posting a wrong password once a minute.
 *
 * So the cost of a wrong password is now paid in time, not in a closed door:
 * every consecutive miss makes the *next miss* take longer to come back, while
 * a correct password is answered straight away and clears the count. A guesser
 * working through one account is down to a couple of tries a minute within
 * seconds; somebody who fat-fingered their password waits nothing at all.
 *
 * What this deliberately gives up: a door that opens for the right password
 * cannot also hide whether a guess was right, so the delay is the whole of the
 * per-account defence. It is backed by a per-IP limit in nginx
 * (web/default.conf.template), which is the layer that can see a guesser
 * running attempts in parallel — this one cannot.
 *
 * Seconds per consecutive failure, last value repeating. Capped below the
 * 60s proxy read timeout in front of us.
 */
const PENALTY_SECONDS = [0, 1, 2, 4, 8, 16, 30]

const penaltyFor = (fails: number) =>
  PENALTY_SECONDS[Math.min(Math.max(fails, 1), PENALTY_SECONDS.length) - 1]

const wait = (seconds: number) =>
  seconds > 0 ? new Promise((r) => setTimeout(r, seconds * 1000)) : Promise.resolve()

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const login = normalizeUsername(body.login)
  const password = typeof body.password === 'string' ? body.password : ''

  if (!login || !password) {
    return NextResponse.json({ error: 'Login va parolni kiriting' }, { status: 400 })
  }

  const row = await asSystem(async (db) => {
    const r = await db.execute(sql`
      select id, password_hash, active, must_change_password, failed_logins
        from users
       where lower(username) = ${login}`)
    return r.rows[0] as {
      id: string; password_hash: string | null; active: boolean
      must_change_password: boolean; failed_logins: number
    } | undefined
  })

  // A caller with no user to check still pays for a real derivation, so a
  // first wrong username and a first wrong password come back alike. Past the
  // first miss the delay below only exists for a name that is real, which is a
  // small tell — the per-IP cap in nginx is what keeps anyone from sitting
  // there working through a list to read it.
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH)

  if (!row || !ok) {
    // Count the miss, then sit on the answer for as long as the count has
    // earned. The count is read back from the UPDATE so that two attempts
    // racing each other are charged separately rather than both paying the
    // old price.
    let fails = 1
    if (row) {
      fails = await asSystem(async (db) => {
        const r = await db.execute(sql`
          update users set failed_logins = failed_logins + 1
           where id = ${row.id}
          returning failed_logins`)
        return (r.rows[0] as { failed_logins: number } | undefined)?.failed_logins ?? 1
      })
    }
    await wait(penaltyFor(fails))
    // Nothing about the count goes in the response: the answer to every miss
    // is the same 401 with the same message, as it was before.
    return NextResponse.json({ error: WRONG }, { status: 401 })
  }

  // Right password. Past here nothing may turn it away except the account
  // itself being switched off.
  if (!row.active) {
    return NextResponse.json({ error: 'Hisobingiz faolsizlantirilgan. Rahbaringizga murojaat qiling.' },
      { status: 403 })
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
