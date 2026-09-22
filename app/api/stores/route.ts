import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgArray, pgCode } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { REF_CACHE } from '@/lib/httpCache'

/**
 * Stores.
 *
 * ?menga=1 the shops assigned to THIS person: theirs outright
 *          (stores.owner_id) OR on their weekly plan. The new-visit form shows
 *          exactly this list, and db/31 makes v_insert accept exactly the same
 *          set, so anything offered here can actually be filed. Before db/31
 *          only owner_id counted, and a manager whose work came from the plan
 *          alone got an empty dropdown under a home screen promising a hundred
 *          shops.
 * ?reja=1  shops that are overdue by visit_every_days, newest-overdue first.
 *          Shop-level and the same for everyone.
 * ?hudud=  restrict the full list to one region code ('01', '40'). For the
 *          assignment screen, which hands over a region at a time. A shop with
 *          no region (no location in the sheet, or abroad) is in no region's
 *          list and so is never handed to anyone in bulk.
 */
export async function GET(req: Request) {
  const me = await requireUserId()
  const q = new URL(req.url).searchParams
  const due = q.get('reja') === '1'
  const mine = q.get('menga') === '1'
  const hudud = (q.get('hudud') ?? '').trim()

  const rows = await asUser(me, async (db) => {
    if (mine) {
      const r = await db.execute(sql`
        select s.id, s.code, s.name, s.region, s.region_code, s.hudud,
               s.kun_otdi, s.visit_every_days,
               to_char(min(p.visit_date), 'YYYY-MM-DD') as reja_sana,
               min(p.week_start) < week_of()            as eski,
               bool_and(p.bajarildi)                    as bajarildi
          from v_menga_biriktirilgan s
          left join v_week_plan p
            on p.store_id = s.id
           and p.user_id = current_user_id()
           and (p.week_start = week_of() or (p.week_start < week_of() and not p.bajarildi))
         where s.owner_id = current_user_id()
            or exists (select 1 from week_plans w
                        where w.store_id = s.id and w.user_id = current_user_id())
         group by s.id, s.code, s.name, s.region, s.region_code, s.hudud,
                  s.kun_otdi, s.visit_every_days
         order by min(p.visit_date) nulls last, s.code`)
      return r.rows
    }

    if (due) {
      const r = await db.execute(sql`
        select s.id, s.code, s.name, s.region, r.kun_otdi, r.oxirgi_vizit
          from stores s join v_bugungi_reja r on r.store_id = s.id
         order by r.kun_otdi desc`)
      return r.rows
    }

    const r = await db.execute(sql`
      select s.id, s.code, s.name, s.region, s.region_code, g.name as hudud,
             s.owner_id, u.full_name as owner_name
        from stores s
        left join regions g on g.code = s.region_code
        left join users u on u.id = s.owner_id
       where s.active
         and (${hudud} = '' or s.region_code = ${hudud})
       order by s.code`)
    return r.rows
  })

  return NextResponse.json(rows, { headers: REF_CACHE })
}

/**
 * Hand shops over to a person, or to nobody. Bulk because a region is handed
 * over in one go and one request per store would be 121 of them.
 *
 * Either an explicit `store_ids`, or `hudud` — every active shop of one region.
 * The second is what the assignment screen actually uses, and it is also what
 * makes a re-import safe: run it again and the region's new shops are covered.
 *
 * RLS (s_write, can_manage_users) is what actually authorises this.
 */
export async function PATCH(req: Request) {
  const me = await requireUserId()
  const b = await req.json()
  // stores.id is a bigserial, not a uuid — the users it is being handed to are.
  const ids: number[] = (Array.isArray(b.store_ids) ? b.store_ids : []).map(Number)
  const hudud = typeof b.hudud === 'string' ? b.hudud.trim() : ''

  if (!ids.length && !hudud) {
    return NextResponse.json({ error: 'do‘kon yoki hudud tanlanmagan' }, { status: 400 })
  }
  if (ids.length && !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    return NextResponse.json({ error: 'bad store id' }, { status: 400 })
  }
  if (b.owner_id && !/^[0-9a-f-]{36}$/.test(b.owner_id)) {
    return NextResponse.json({ error: 'bad owner id' }, { status: 400 })
  }

  try {
    const { n, target } = await asUser(me, async (db) => {
      // How many rows SHOULD move. s_read lets every signed-in person read the
      // store table, so this number is the same for an admin and a manager —
      // which is what lets "nothing moved" below mean "not allowed" rather
      // than "nothing to move". Without it a manager's attempt and an empty
      // region are the same answer, and one of them is a 403.
      const t = hudud
        ? await db.execute(sql`select count(*)::int as n from stores where active and region_code = ${hudud}`)
        : await db.execute(sql`select count(*)::int as n from stores where id = any(${pgArray(ids)}::bigint[])`)

      // Drizzle inlines a JS array as a value list, so bind a pg array literal.
      const r = hudud
        ? await db.execute(sql`
            update stores set owner_id = ${b.owner_id || null}
             where active and region_code = ${hudud}
            returning id`)
        : await db.execute(sql`
            update stores set owner_id = ${b.owner_id || null}
             where id = any(${pgArray(ids)}::bigint[])
            returning id`)
      return { n: r.rows.length, target: (t.rows[0] as { n: number }).n }
    })
    if (!n) {
      return target
        ? NextResponse.json({ error: 'ruxsat yo‘q' }, { status: 403 })
        : NextResponse.json(
            { error: hudud ? 'bu hududda faol do‘kon yo‘q' : 'bunday do‘kon yo‘q' },
            { status: 404 },
          )
    }
    return NextResponse.json({ updated: n })
  } catch (e: unknown) {
    if (pgCode(e) === '42501') return NextResponse.json({ error: 'ruxsat yo‘q' }, { status: 403 })
    throw e
  }
}
