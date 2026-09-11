import { NextResponse } from 'next/server'
import { asSystem } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { verifyTelegramLogin, displayName, type TelegramAuth } from '@/lib/telegram'
import { setSession } from '@/lib/session'

/**
 * Telegram Login Widget callback. Accounts are never created here — an unknown
 * telegram_id is rejected, so only people Komil has added can get in.
 */
export async function POST(req: Request) {
  const data = (await req.json()) as TelegramAuth

  if (!verifyTelegramLogin(data, process.env.TELEGRAM_BOT_TOKEN!)) {
    return NextResponse.json({ error: 'invalid telegram signature' }, { status: 401 })
  }

  // Login has to read users before a session exists, so it bypasses RLS.
  const user = await asSystem(async (db) => {
    const { rows } = await db.execute(sql`
      update users
         set telegram_username = ${data.username ?? null},
             full_name = case when full_name = '' then ${displayName(data)} else full_name end
       where telegram_id = ${data.id} and active
       returning id, full_name, role
    `)
    return rows[0] as { id: string; full_name: string; role: string } | undefined
  })

  if (!user) {
    return NextResponse.json({ error: 'account not found or inactive' }, { status: 403 })
  }

  await setSession(user.id)
  return NextResponse.json({ id: user.id, full_name: user.full_name, role: user.role })
}
