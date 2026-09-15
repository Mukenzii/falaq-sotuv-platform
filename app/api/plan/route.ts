import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgArray, pgCode } from '@/lib/db'
import { requireUserId } from '@/lib/session'

/**
 * The weekly plan: which shops each person must visit, and on which days.
 *
 * A task is (shop, day) — one person per shop per day, and a shop may be
 * planned on several days of a week. A week is named by its Monday. RLS does
 * the scoping — an admin sees and edits everyone, a manager sees their own
 * week and their team's, and nobody else's.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date as YYYY-MM-DD, or null. */
function parseDate(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE.test(value)) return null
  const d = new Date(value + 'T00:00:00Z')
  return !isNaN(+d) && d.toISOString().slice(0, 10) === value ? value : null
}

/** Monday of the week containing the given date, or of this week. */
function mondayOf(value: string | null): string {
  const d = parseDate(value) ? new Date(value + 'T00:00:00Z') : new Date()
  const day = (d.getUTCDay() + 6) % 7          // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

const ids = (v: unknown): number[] | null => {
  const a = (Array.isArray(v) ? v : []).map(Number)
  return a.length && a.every((n) => Number.isSafeInteger(n) && n > 0) ? a : null
}
const UUID = /^[0-9a-f-]{36}$/

function fail(e: unknown) {
  if (pgCode(e) === '42501') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
  if (pgCode(e) === '23503') return NextResponse.json({ error: 'topilmadi' }, { status: 404 })
  if (pgCode(e) === '23514') return NextResponse.json({ error: 'kun shu haftada emas' }, { status: 400 })
  if (pgCode(e) === '23505') {
    return NextResponse.json({ error: "bu do'kon o'sha kuni rejada allaqachon bor" }, { status: 409 })
  }
  throw e
}

export async function GET(req: Request) {
  const me = await requireUserId()
  const week = mondayOf(new URL(req.url).searchParams.get('hafta'))

  const data = await asUser(me, async (db) => {
    const rows = await db.execute(sql`
      select week_start, to_char(visit_date, 'YYYY-MM-DD') visit_date, holat,
             user_id, full_name, store_id, code, store_name, store_category,
             bajarildi, to_char(visited_at, 'YYYY-MM-DD') visited_at,
             to_char(boshqa_vizit, 'YYYY-MM-DD') boshqa_vizit
        from v_week_plan
       where week_start = ${week}
       order by visit_date, full_name, code, store_id`)

    const summary = await db.execute(sql`
      select user_id, full_name, reja, bajarildi, vaqtida, kechikdi, qoldi, borilmadi, foiz
        from v_week_summary where week_start = ${week}
       order by foiz nulls last, full_name`)

    // everyone who could be given a shop, and every shop that could be given
    const people = await db.execute(sql`
      select id, full_name, role from users where active order by role, full_name`)
    const stores = await db.execute(sql`
      select id, code, name, category, territory, store_type from stores where active order by code`)

    const meta = await db.execute(sql`
      select can_manage_users() ok, current_date::text today`)
    const m = meta.rows[0] as { ok: boolean; today: string }

    return {
      week,
      today: m.today,
      rows: rows.rows,
      summary: summary.rows,
      people: people.rows,
      stores: stores.rows,
      canEdit: !!m.ok,
    }
  })

  return NextResponse.json(data)
}

/**
 * Give a set of shops to one person on one or more days: every shop on every
 * day. `sanalar` is the list of days; a single `sana` is still accepted.
 */
export async function POST(req: Request) {
  const me = await requireUserId()
  const b = await req.json().catch(() => ({}))
  const raw: unknown[] = Array.isArray(b.sanalar) ? b.sanalar : b.sana !== undefined ? [b.sana] : []
  const days = [...new Set(raw.map(parseDate))]
  const userId = String(b.user_id ?? '')
  const storeIds = ids(b.store_ids)

  if (!UUID.test(userId)) return NextResponse.json({ error: 'xodim tanlanmagan' }, { status: 400 })
  if (!days.length || days.includes(null)) {
    return NextResponse.json({ error: 'kun tanlanmagan' }, { status: 400 })
  }
  if (!storeIds) return NextResponse.json({ error: "do'kon tanlanmagan" }, { status: 400 })
  const weeks = new Set(days.map((d) => mondayOf(d)))
  if (weeks.size > 1) return NextResponse.json({ error: 'kunlar bitta haftada bo‘lsin' }, { status: 400 })
  const week = [...weeks][0]

  try {
    const n = await asUser(me, async (db) => {
      // The same shop on the same day is one task: planning it again hands it
      // to the new person instead of duplicating it.
      const r = await db.execute(sql`
        insert into week_plans (week_start, visit_date, store_id, user_id, created_by)
        select ${week}, d, s, ${userId}, ${me}
          from unnest(${pgArray(storeIds)}::bigint[]) as s
         cross join unnest(${pgArray(days as string[])}::date[]) as d
        on conflict (store_id, visit_date) do update
          set user_id = excluded.user_id, created_by = excluded.created_by, created_at = now()
        returning store_id`)
      return r.rows.length
    })
    if (!n) return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
    return NextResponse.json({ week, days, assigned: n })
  } catch (e) {
    return fail(e)
  }
}

/**
 * Change one task, named by its shop and day (`sana`): move it to another day
 * of the same week (`yangi_sana`) and/or give it to another person.
 */
export async function PATCH(req: Request) {
  const me = await requireUserId()
  const b = await req.json().catch(() => ({}))
  const storeId = Number(b.store_id)
  const day = parseDate(b.sana)
  const to = b.yangi_sana === undefined ? null : parseDate(b.yangi_sana)
  const userId = b.user_id === undefined ? null : String(b.user_id)

  if (!Number.isSafeInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ error: 'bad store id' }, { status: 400 })
  }
  if (!day) return NextResponse.json({ error: 'kun tanlanmagan' }, { status: 400 })
  if (b.yangi_sana !== undefined && !to) return NextResponse.json({ error: 'kun noto‘g‘ri' }, { status: 400 })
  if (userId !== null && !UUID.test(userId)) {
    return NextResponse.json({ error: 'xodim tanlanmagan' }, { status: 400 })
  }
  if (!to && !userId) return NextResponse.json({ error: "o'zgarish yo'q" }, { status: 400 })
  // The week is part of the task: moving it to another week is a new plan.
  if (to && mondayOf(to) !== mondayOf(day)) {
    return NextResponse.json({ error: 'kun shu haftada emas' }, { status: 400 })
  }

  try {
    const res = await asUser(me, async (db) => {
      const admin = await db.execute(sql`select can_manage_users() ok`)
      if (!(admin.rows[0] as { ok: boolean }).ok) return 'forbidden' as const
      const r = await db.execute(sql`
        update week_plans
           set visit_date = coalesce(${to}::date, visit_date),
               user_id    = coalesce(${userId}::uuid, user_id)
         where store_id = ${storeId} and visit_date = ${day}
        returning store_id`)
      return r.rows.length
    })
    if (res === 'forbidden') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
    if (!res) return NextResponse.json({ error: 'topilmadi' }, { status: 404 })
    return NextResponse.json({ store_id: storeId, sana: to ?? day, moved: true })
  } catch (e) {
    return fail(e)
  }
}

/** Take shops off the plan: one day's task with `sana`, else the whole week. */
export async function DELETE(req: Request) {
  const me = await requireUserId()
  const b = await req.json().catch(() => ({}))
  const storeIds = ids(b.store_ids)
  const day = b.sana === undefined ? null : parseDate(b.sana)
  if (!storeIds) return NextResponse.json({ error: "do'kon tanlanmagan" }, { status: 400 })
  if (b.sana !== undefined && !day) return NextResponse.json({ error: 'kun noto‘g‘ri' }, { status: 400 })
  const week = mondayOf(day ?? b.hafta ?? null)

  try {
    const n = await asUser(me, async (db) => {
      const r = day
        ? await db.execute(sql`
            delete from week_plans
             where visit_date = ${day} and store_id = any(${pgArray(storeIds)}::bigint[])
            returning store_id`)
        : await db.execute(sql`
            delete from week_plans
             where week_start = ${week} and store_id = any(${pgArray(storeIds)}::bigint[])
            returning store_id`)
      return r.rows.length
    })
    return NextResponse.json({ week, removed: n })
  } catch (e) {
    return fail(e)
  }
}
