import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgArray, pgCode } from '@/lib/db'
import { requireUserId } from '@/lib/session'

/**
 * The weekly plan: which shops each person must visit this week.
 *
 * A week is named by its Monday. RLS does the scoping — an admin sees and
 * edits everyone, a manager sees their own week and their team's, and nobody
 * else's. There is no territory any more: any shop can be given to anyone.
 */

/** Monday of the week containing the given date, or of this week. */
function mondayOf(value: string | null): string {
  const d = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : new Date()
  const day = (d.getUTCDay() + 6) % 7          // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  const me = await requireUserId()
  const week = mondayOf(new URL(req.url).searchParams.get('hafta'))

  const data = await asUser(me, async (db) => {
    const rows = await db.execute(sql`
      select week_start, user_id, full_name, store_id, code, store_name, store_category,
             bajarildi, to_char(visited_at, 'YYYY-MM-DD') visited_at,
             to_char(boshqa_vizit, 'YYYY-MM-DD') boshqa_vizit
        from v_week_plan
       where week_start = ${week}
       order by full_name, bajarildi, code`)

    const summary = await db.execute(sql`
      select user_id, full_name, reja, bajarildi, qoldi, foiz
        from v_week_summary where week_start = ${week}
       order by foiz nulls last, full_name`)

    // everyone who could be given a shop, and every shop that could be given
    const people = await db.execute(sql`
      select id, full_name, role from users where active order by role, full_name`)
    const stores = await db.execute(sql`
      select id, code, name, category from stores where active order by code`)

    const admin = await db.execute(sql`select can_manage_users() ok`)

    return {
      week,
      rows: rows.rows,
      summary: summary.rows,
      people: people.rows,
      stores: stores.rows,
      canEdit: !!(admin.rows[0] as { ok: boolean }).ok,
    }
  })

  return NextResponse.json(data)
}

/** Give a set of shops to one person for one week. */
export async function POST(req: Request) {
  const me = await requireUserId()
  const b = await req.json().catch(() => ({}))
  const week = mondayOf(b.hafta ?? null)
  const userId = String(b.user_id ?? '')
  const ids: number[] = (Array.isArray(b.store_ids) ? b.store_ids : []).map(Number)

  if (!/^[0-9a-f-]{36}$/.test(userId)) return NextResponse.json({ error: 'xodim tanlanmagan' }, { status: 400 })
  if (!ids.length) return NextResponse.json({ error: "do'kon tanlanmagan" }, { status: 400 })
  if (!ids.every((n) => Number.isSafeInteger(n) && n > 0)) {
    return NextResponse.json({ error: 'bad store id' }, { status: 400 })
  }

  try {
    const n = await asUser(me, async (db) => {
      // A shop belongs to one person per week, so re-assigning moves it
      // rather than duplicating the task.
      const r = await db.execute(sql`
        insert into week_plans (week_start, store_id, user_id, created_by)
        select ${week}, x, ${userId}, ${me} from unnest(${pgArray(ids)}::bigint[]) as x
        on conflict (week_start, store_id) do update
          set user_id = excluded.user_id, created_by = excluded.created_by, created_at = now()
        returning store_id`)
      return r.rows.length
    })
    if (!n) return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
    return NextResponse.json({ week, assigned: n })
  } catch (e) {
    if (pgCode(e) === '42501') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
    if (pgCode(e) === '23503') return NextResponse.json({ error: 'topilmadi' }, { status: 404 })
    throw e
  }
}

/** Take shops off the week's plan. */
export async function DELETE(req: Request) {
  const me = await requireUserId()
  const b = await req.json().catch(() => ({}))
  const week = mondayOf(b.hafta ?? null)
  const ids: number[] = (Array.isArray(b.store_ids) ? b.store_ids : []).map(Number)

  if (!ids.length) return NextResponse.json({ error: "do'kon tanlanmagan" }, { status: 400 })
  if (!ids.every((n) => Number.isSafeInteger(n) && n > 0)) {
    return NextResponse.json({ error: 'bad store id' }, { status: 400 })
  }

  try {
    const n = await asUser(me, async (db) => {
      const r = await db.execute(sql`
        delete from week_plans
         where week_start = ${week} and store_id = any(${pgArray(ids)}::bigint[])
        returning store_id`)
      return r.rows.length
    })
    return NextResponse.json({ week, removed: n })
  } catch (e) {
    if (pgCode(e) === '42501') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
    throw e
  }
}
