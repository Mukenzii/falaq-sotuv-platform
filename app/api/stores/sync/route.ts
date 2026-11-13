import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { hasServiceAccount, storesSource } from '@/lib/sheets'
import { BigRemoval, importStoresFromSheet } from '@/lib/storeImport'

export const maxDuration = 60

/**
 * Rebuild the store directory from the "Sotuv uchun" spreadsheet. Admins only.
 * Shops are upserted by code; shops that left the sheet become inactive.
 * When more than half would go, it answers 409 with the count and some of the
 * codes, and the same call with { force: true } applies it.
 */
export async function POST(req: Request) {
  const me = await requireUserId()
  const force = (await req.json().catch(() => ({})))?.force === true

  const allowed = await asUser(me, async (db) => {
    const r = await db.execute(sql`select can_manage_users() ok`)
    return !!(r.rows[0] as { ok: boolean }).ok
  })
  if (!allowed) return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })

  if (!hasServiceAccount() || !storesSource()) {
    return NextResponse.json({ error: 'Google Sheets sozlanmagan' }, { status: 503 })
  }

  try {
    return NextResponse.json({ ok: true, ...(await importStoresFromSheet({ force })) })
  } catch (e) {
    if (e instanceof BigRemoval) {
      return NextResponse.json({
        error: e.message, confirm: true,
        leaving: e.leaving, active: e.active, inSheet: e.inSheet, sample: e.sample,
      }, { status: 409 })
    }
    // no access to the sheet, a renamed tab, or the safety refusal
    return NextResponse.json({
      error: (e as Error).message,
      source: storesSource(),
      account: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    }, { status: 502 })
  }
}
