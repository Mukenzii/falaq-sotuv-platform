import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { timingSafeEqual } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { asSystem } from '@/lib/db'
import { setSession } from '@/lib/session'
import { drainUpdates } from '@/lib/telegramBot'
import { NONCE_COOKIE } from '@/lib/loginNonce'

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * The waiting login page asks this every couple of seconds. Each call first
 * pulls any pending bot updates (see lib/telegramBot.ts for why the drain lives
 * on the request path), then reports what happened to this particular nonce.
 */
export async function GET(req: Request) {
  const nonce = new URL(req.url).searchParams.get('nonce') ?? ''
  const owned = (await cookies()).get(NONCE_COOKIE)?.value ?? ''
  if (!/^[a-f0-9]{32}$/.test(nonce) || !owned || !same(nonce, owned)) {
    return NextResponse.json({ error: 'invalid login session' }, { status: 400 })
  }

  await drainUpdates()

  const outcome = await asSystem(async (db) => {
    // Consume and resolve in one statement: two tabs polling the same nonce
    // must not both walk away with a session.
    const claimed = await db.execute(sql`
      update login_tokens
         set consumed_at = now()
       where nonce = ${nonce} and claimed_at is not null and consumed_at is null
      returning telegram_id`)
    if (!claimed.rows.length) {
      const still = await db.execute(sql`
        select 1 from login_tokens
         where nonce = ${nonce} and created_at > now() - interval '10 minutes'`)
      return still.rows.length ? { state: 'pending' as const } : { state: 'expired' as const }
    }

    const tg = (claimed.rows[0] as { telegram_id: string }).telegram_id
    const user = await db.execute(sql`
      update users
         set full_name = case when full_name = '' then ${String(tg)} else full_name end
       where telegram_id = ${tg} and active
      returning id, full_name, role`)

    return user.rows.length
      ? { state: 'ok' as const, user: user.rows[0] as { id: string; full_name: string; role: string } }
      : { state: 'unknown' as const }
  })

  if (outcome.state === 'ok') {
    await setSession(outcome.user.id)
    const res = NextResponse.json({ state: 'ok', user: outcome.user })
    res.cookies.delete(NONCE_COOKIE)
    return res
  }
  if (outcome.state === 'unknown') {
    return NextResponse.json(
      { state: 'unknown', error: 'Bu Telegram hisobi tizimga qo‘shilmagan.' },
      { status: 403 },
    )
  }
  return NextResponse.json({ state: outcome.state })
}
