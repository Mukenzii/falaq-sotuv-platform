import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { asSystem } from '@/lib/db'
import { NONCE_COOKIE } from '@/lib/loginNonce'
import { cookieSecure } from '@/lib/session'

/**
 * Mint a one-time nonce and hand back the deep link that carries it to the bot.
 * The nonce also goes into an httpOnly cookie, so only the browser that started
 * the login can later exchange it for a session — someone who merely sees the
 * link can press it (and be told whether they are on the list) but cannot take
 * over the waiting page.
 */
export async function POST() {
  const bot = process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
  if (!bot || !process.env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: 'telegram bot is not configured' }, { status: 503 })
  }

  const nonce = randomBytes(16).toString('hex')

  await asSystem(async (db) => {
    await db.execute(sql`delete from login_tokens where created_at < now() - interval '1 hour'`)
    await db.execute(sql`insert into login_tokens (nonce) values (${nonce})`)
  })

  const res = NextResponse.json({
    nonce,
    url: `https://t.me/${bot}?start=${nonce}`,
    // tg:// is handed to the installed Telegram app by the OS, so the browser
    // tab never navigates. That matters: the login page has to stay in front
    // and keep polling, or the person comes back from Telegram to a t.me tab
    // and has to hunt for the tab that actually logged them in.
    deeplink: `tg://resolve?domain=${bot}&start=${nonce}`,
  })
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await cookieSecure(),
    path: '/',
    maxAge: 600,
  })
  return res
}
