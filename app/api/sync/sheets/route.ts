import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { isConfigured, sheetsProblem, spreadsheetTarget } from '@/lib/sheets'
import { runSheetsSync, sheetsStatus, ensureSheetsSyncing } from '@/lib/sheetsSync'

export const maxDuration = 60

export async function GET() {
  const me = await requireUserId()
  // Opening the page is also what arms the retry loop after a restart.
  ensureSheetsSyncing()

  const info = await asUser(me, async (db) => {
    const r = await db.execute(sql`
      select (select count(*) from visits) visits,
             (select count(*) from visit_books) visit_books,
             (select max(visited_at) from visits) oxirgi`)
    return r.rows[0]
  })
  return NextResponse.json({
    configured: isConfigured(),
    problem: sheetsProblem(),
    sheet: spreadsheetTarget(),   // so the page can say which spreadsheet, and link to it
    // not a secret: it is the address the sheet has to be shared with
    account: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    ...info,
    ...(await sheetsStatus()),
  })
}

/**
 * Push now. Visits push themselves the moment they are saved, so this is for
 * forcing one after an outage or after editing the form — it is the same code
 * path, and it always writes everything, never just what the caller can see.
 */
export async function POST() {
  const me = await requireUserId()

  // Any signed-in user may ask; the push itself is system-wide either way.
  const allowed = await asUser(me, async (db) => {
    const r = await db.execute(sql`select can_manage_users() ok`)
    return !!(r.rows[0] as { ok: boolean }).ok
  })
  if (!allowed) return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })

  const out = await runSheetsSync()
  if (out.ok) return NextResponse.json({ ok: true, wrote: out.wrote, at: new Date().toISOString() })
  if (out.reason === 'not-configured') {
    return NextResponse.json({ error: sheetsProblem() ?? 'Google Sheets sozlanmagan' }, { status: 503 })
  }
  if (out.reason === 'paused') {
    return NextResponse.json({ error: 'Yuborish vaqtincha to‘xtatilgan' }, { status: 409 })
  }
  if (out.reason === 'busy') {
    return NextResponse.json({ error: 'Hozir yuborilmoqda, biroz kuting' }, { status: 409 })
  }
  return NextResponse.json({ error: out.error }, { status: 502 })
}
