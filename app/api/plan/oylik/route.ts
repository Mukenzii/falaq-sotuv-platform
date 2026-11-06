import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

/**
 * The plan summary for one calendar month (`oy=YYYY-MM`, default: this month),
 * in the same columns as the weekly one. month_summary() runs under the
 * caller's RLS (db/34): an agent gets their own row, a head their regions'
 * managers and their branch, an admin everyone.
 */
export async function GET(req: Request) {
  let me: string
  try { me = await requireUserId() } catch { return NextResponse.json({ error: 'kirish kerak' }, { status: 401 }) }
  const raw = new URL(req.url).searchParams.get('oy')
  if (raw !== null && !MONTH.test(raw)) {
    return NextResponse.json({ error: 'oy YYYY-MM ko‘rinishida bo‘lsin' }, { status: 400 })
  }

  const data = await asUser(me, async (db) => {
    const m = (await db.execute(raw
      ? sql`select ${raw + '-01'}::date::text as month`
      : sql`select date_trunc('month', current_date)::date::text as month`)).rows[0] as { month: string }
    const rows = await db.execute(sql`
      select user_id, full_name, reja, bajarildi, vaqtida, kechikdi, qoldi, borilmadi, foiz
        from month_summary(${m.month}::date)
       order by foiz nulls last, full_name`)
    return { month: m.month, rows: rows.rows }
  })

  return NextResponse.json(data)
}
