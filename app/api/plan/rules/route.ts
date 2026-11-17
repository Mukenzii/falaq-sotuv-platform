import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgArray, pgCode, type Tx } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { ensurePlanTopUp } from '@/lib/planLoop'
import { HORIZON_WEEKS, isCadence, mondayOf, parseDate, weekdayOf } from '@/lib/plan'

/**
 * Repeating plans: a shop, a person, a weekday and how often (db/23).
 *
 * A rule is not a second kind of task. Saving one writes ordinary week_plans
 * rows for the next few weeks and then gets out of the way, so the board, the
 * statuses and the manager's dropdown never have to know it existed. What the
 * rule keeps is the ability to refill the horizon as time moves on.
 */

const UUID = /^[0-9a-f-]{36}$/
const ids = (v: unknown): number[] | null => {
  const a = (Array.isArray(v) ? v : []).map(Number)
  return a.length && a.every((n) => Number.isSafeInteger(n) && n > 0) ? a : null
}

function fail(e: unknown) {
  if (pgCode(e) === '42501') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
  if (pgCode(e) === '23503') return NextResponse.json({ error: 'topilmadi' }, { status: 404 })
  throw e
}

/** Every live rule, with how many future tasks it has already placed. */
export async function GET() {
  const me = await requireUserId()

  // anyone opening the plan arms the nightly top-up; it is a no-op after the first
  ensurePlanTopUp()

  const data = await asUser(me, async (db) => {
    const rows = await db.execute(sql`
      select r.id, r.store_id, s.code, s.name as store_name,
             r.user_id, u.full_name, r.weekday, r.cadence,
             to_char(r.anchor, 'YYYY-MM-DD') anchor,
             (select count(*) from week_plans w
               where w.rule_id = r.id and w.visit_date >= current_date) as kelajak
        from plan_rules r
        join stores s on s.id = r.store_id
        join users  u on u.id = r.user_id
       where r.active
       order by u.full_name, r.weekday, s.code`)
    const meta = await db.execute(sql`select can_plan_any() ok`)
    return { rows: rows.rows, canEdit: !!(meta.rows[0] as { ok: boolean }).ok }
  })

  return NextResponse.json(data)
}

/**
 * Save rules for a set of shops, or top the horizon up.
 *
 * `sanalar` are the days chosen on the board — the weekday of each is what the
 * rule keeps, and the Monday of the earliest is the anchor the counted
 * cadences measure from. Re-saving the same shop/weekday/person edits that
 * rule instead of adding another.
 */
/**
 * The days these rules should fill and did not, and why: a day already given
 * to someone else (one person per shop per day), a day taken off and kept off,
 * or a day already past. Without it, "0 ta reja yozildi" is all the admin sees.
 */
async function whyNotPlanned(db: Tx, ruleIds: number[]) {
  const days = sql`
    select r.id, r.store_id, r.user_id, (w.w + r.weekday)::date as day
      from plan_rules r
     cross join (select (week_of() + (i * 7))::date w from generate_series(0, ${HORIZON_WEEKS - 1}) i) w
     where r.id = any(${pgArray(ruleIds)}::bigint[])
       and plan_rule_fires(r.cadence, r.anchor, r.weekday, w.w)`
  const c = (await db.execute(sql`
    with d as (${days})
    select count(*) filter (where day < current_date)::int as past,
           count(*) filter (where day >= current_date and exists (
             select 1 from plan_rule_skips k where k.rule_id = d.id and k.visit_date = d.day))::int as skipped,
           count(*) filter (where day >= current_date and exists (
             select 1 from week_plans p
              where p.store_id = d.store_id and p.visit_date = d.day and p.user_id <> d.user_id))::int as taken
      from d`)).rows[0] as { past: number; skipped: number; taken: number }
  const takenBy = c.taken ? (await db.execute(sql`
    with d as (${days})
    select distinct s.code, u.full_name
      from d
      join week_plans p on p.store_id = d.store_id and p.visit_date = d.day and p.user_id <> d.user_id
      join stores s on s.id = p.store_id
      left join users u on u.id = p.user_id
     where d.day >= current_date
     order by s.code
     limit 6`)).rows as Array<{ code: string; full_name: string | null }> : []
  return { ...c, takenBy }
}

export async function POST(req: Request) {
  const me = await requireUserId()
  const b = await req.json().catch(() => ({}))

  // "fill the next weeks from the rules I already have"
  if (b.tuldirish === true) {
    try {
      const planned = await asUser(me, async (db) => {
        const admin = await db.execute(sql`select can_plan_any() ok`)
        if (!(admin.rows[0] as { ok: boolean }).ok) return 'forbidden' as const
        const r = await db.execute(sql`select plan_generate(${HORIZON_WEEKS}) n`)
        return Number((r.rows[0] as { n: number }).n)
      })
      if (planned === 'forbidden') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
      return NextResponse.json({ planned, weeks: HORIZON_WEEKS })
    } catch (e) {
      return fail(e)
    }
  }

  const raw: unknown[] = Array.isArray(b.sanalar) ? b.sanalar : b.sana !== undefined ? [b.sana] : []
  const days = [...new Set(raw.map(parseDate))]
  const userId = String(b.user_id ?? '')
  const storeIds = ids(b.store_ids)
  const cadence = b.takror

  if (!UUID.test(userId)) return NextResponse.json({ error: 'xodim tanlanmagan' }, { status: 400 })
  if (!days.length || days.includes(null)) {
    return NextResponse.json({ error: 'kun tanlanmagan' }, { status: 400 })
  }
  if (!storeIds) return NextResponse.json({ error: "do'kon tanlanmagan" }, { status: 400 })
  if (!isCadence(cadence)) return NextResponse.json({ error: 'takrorlanish noto‘g‘ri' }, { status: 400 })

  const weekdays = [...new Set((days as string[]).map(weekdayOf))]
  const anchor = mondayOf((days as string[]).slice().sort()[0])

  try {
    const out = await asUser(me, async (db) => {
      const admin = await db.execute(sql`select can_plan_any() ok`)
      if (!(admin.rows[0] as { ok: boolean }).ok) return 'forbidden' as const

      const r = await db.execute(sql`
        insert into plan_rules (store_id, user_id, weekday, cadence, anchor, created_by)
        select s, ${userId}, d, ${cadence}, ${anchor}::date, ${me}
          from unnest(${pgArray(storeIds)}::bigint[]) as s
         cross join unnest(${pgArray(weekdays)}::int[]) as d
        on conflict (store_id, weekday, user_id) do update
          set cadence = excluded.cadence, anchor = excluded.anchor, active = true
        returning id`)

      const ruleIds = (r.rows as Array<{ id: number }>).map((x) => Number(x.id))
      // Saving a rule again means its days are wanted: days taken off it before
      // stop being skipped. Other rules' removed days are left alone, and only
      // the rules just saved are laid down, so nothing else comes back.
      await db.execute(sql`
        delete from plan_rule_skips
         where rule_id = any(${pgArray(ruleIds)}::bigint[]) and visit_date >= current_date`)
      let planned = 0
      for (const id of ruleIds) {
        const g = await db.execute(sql`select plan_generate(${HORIZON_WEEKS}, ${id}) n`)
        planned += Number((g.rows[0] as { n: number }).n)
      }
      return { rules: ruleIds.length, planned, why: await whyNotPlanned(db, ruleIds) }
    })

    if (out === 'forbidden') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
    return NextResponse.json({ ...out, weeks: HORIZON_WEEKS })
  } catch (e) {
    return fail(e)
  }
}

/**
 * Drop a rule. Its future tasks go with it — nobody wants to clear eight weeks
 * of a mistake by hand — but the past is left exactly as it was, because those
 * weeks are a record of what the team was asked to do.
 */
export async function DELETE(req: Request) {
  const me = await requireUserId()
  const b = await req.json().catch(() => ({}))
  const id = Number(b.id)
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'bad rule id' }, { status: 400 })
  }

  try {
    const out = await asUser(me, async (db) => {
      const admin = await db.execute(sql`select can_plan_any() ok`)
      if (!(admin.rows[0] as { ok: boolean }).ok) return 'forbidden' as const

      const cleared = await db.execute(sql`
        delete from week_plans
         where rule_id = ${id} and visit_date >= current_date
        returning store_id`)
      const gone = await db.execute(sql`delete from plan_rules where id = ${id} returning id`)
      if (!gone.rows.length) return 'missing' as const
      return { removed: cleared.rows.length }
    })

    if (out === 'forbidden') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
    if (out === 'missing') return NextResponse.json({ error: 'topilmadi' }, { status: 404 })
    return NextResponse.json({ deleted: true, ...out })
  } catch (e) {
    return fail(e)
  }
}
