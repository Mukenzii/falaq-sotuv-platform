import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { isConfigured, sheetsProblem, mmlSource } from '@/lib/sheets'
import { importMmlFromSheet } from '@/lib/mmlImport'

export const maxDuration = 60

/**
 * Pull the must-list back out of the spreadsheet.
 *
 * This replaces mml_rules and mml_overrides wholesale, so any chip somebody
 * toggled in the app is discarded — the sheet is the source of truth and the
 * button says so. That is the point: the commercial team works in the sheet.
 */
export async function POST() {
  const me = await requireUserId()

  const allowed = await asUser(me, async (db) => {
    const r = await db.execute(sql`select can_manage_users() ok`)
    return !!(r.rows[0] as { ok: boolean }).ok
  })
  if (!allowed) return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })

  if (!isConfigured()) {
    return NextResponse.json({ error: sheetsProblem() ?? 'Google Sheets sozlanmagan' }, { status: 503 })
  }

  try {
    return NextResponse.json({ ok: true, ...(await importMmlFromSheet()) })
  } catch (e) {
    // a bad tab name or a Google outage, not a crash
    return NextResponse.json({ error: (e as Error).message, source: mmlSource() }, { status: 502 })
  }
}
