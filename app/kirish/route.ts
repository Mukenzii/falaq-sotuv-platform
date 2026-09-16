import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asSystem } from '@/lib/db'
import { setSession } from '@/lib/session'

/**
 * The link the bot sends (db/24). Opening it signs in the account that link
 * was minted for, on whichever device opened it — which is the whole point:
 * the same person signs in on the phone in the shop and on the laptop at the
 * office, and neither logs the other out, because the session cookie carries
 * the user and nothing else.
 *
 * Only tokens the bot issued are accepted here. The browser flow's nonces are
 * bound to a cookie and stay that way: somebody who merely sees one must not
 * be able to trade it for a session by visiting this path.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? ''
  // Relative, deliberately: req.url is the address nginx dialled inside the
  // compose network, so building an absolute URL from it sends a phone to
  // localhost. The browser resolves a relative Location against the address it
  // actually asked for.
  const to = (path: string) => new NextResponse(null, { status: 303, headers: { location: path } })
  if (!/^[a-f0-9]{32}$/.test(token)) return to('/login')

  const user = await asSystem(async (db) => {
    // Consume and read in one statement: a link opened twice, or forwarded,
    // signs in once.
    const used = await db.execute(sql`
      update login_tokens
         set consumed_at = now()
       where nonce = ${token}
         and bot_issued
         and consumed_at is null
         and created_at > now() - interval '10 minutes'
      returning telegram_id`)
    if (!used.rows.length) return null

    const tg = (used.rows[0] as { telegram_id: string }).telegram_id
    const u = await db.execute(sql`
      select id from users where telegram_id = ${tg} and active`)
    return (u.rows[0] as { id: string } | undefined) ?? null
  })

  // An expired or already-used link is not an error worth a page of its own:
  // the login screen is one press away from a fresh one.
  if (!user) return to('/login?eskirgan=1')

  await setSession(user.id)
  return to('/')
}
