import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgArray, pgCode } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { REF_CACHE } from '@/lib/httpCache'

/**
 * Stores this person may visit. RLS narrows it to their own territory,
 * so the dropdown can never offer a store that isn't theirs.
 * ?reja=1 returns only stores that are due, newest-overdue first.
 */
export async function GET(req: Request) {
  const me = await requireUserId()
  const due = new URL(req.url).searchParams.get('reja') === '1'

  const rows = await asUser(me, async (db) => {
    const r = due
      ? await db.execute(sql`
          select s.id, s.code, s.name, s.region, r.kun_otdi, r.oxirgi_vizit
            from stores s join v_bugungi_reja r on r.store_id = s.id
           order by r.kun_otdi desc`)
      : await db.execute(sql`
          select s.id, s.code, s.name, s.region, s.owner_id, u.full_name as owner_name
            from stores s
            left join users u on u.id = s.owner_id
           where s.active order by s.code`)
    return r.rows
  })

  return NextResponse.json(rows, { headers: REF_CACHE })
}

/**
 * Assign stores to a person, or to nobody. Bulk because the setup screen hands
 * over a whole territory at once and one request per store would be 60.
 * RLS (s_write, can_manage_users) is what actually authorises this.
 */
export async function PATCH(req: Request) {
  const me = await requireUserId()
  const b = await req.json()
  // stores.id is a bigserial, not a uuid — the users it is being handed to are.
  const ids: number[] = (Array.isArray(b.store_ids) ? b.store_ids : []).map(Number)

  if (!ids.length) return NextResponse.json({ error: 'do‘kon tanlanmagan' }, { status: 400 })
  if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    return NextResponse.json({ error: 'bad store id' }, { status: 400 })
  }
  if (b.owner_id && !/^[0-9a-f-]{36}$/.test(b.owner_id)) {
    return NextResponse.json({ error: 'bad owner id' }, { status: 400 })
  }

  try {
    const n = await asUser(me, async (db) => {
      // Drizzle inlines a JS array as a value list, so bind a pg array literal.
      const r = await db.execute(sql`
        update stores set owner_id = ${b.owner_id || null}
         where id = any(${pgArray(ids)}::bigint[])
        returning id`)
      return r.rows.length
    })
    if (!n) return NextResponse.json({ error: 'ruxsat yo‘q' }, { status: 403 })
    return NextResponse.json({ updated: n })
  } catch (e: unknown) {
    if (pgCode(e) === '42501') return NextResponse.json({ error: 'ruxsat yo‘q' }, { status: 403 })
    throw e
  }
}
