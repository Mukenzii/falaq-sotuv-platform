import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { REF_CACHE } from '@/lib/httpCache'

/**
 * The 14 regions of Uzbekistan plus "Boshqa", with how many shops sit in each
 * and who they are already handed to. The assignment screen is the only
 * caller, and it needs all three numbers at once to say "Farg'ona — 121 shops,
 * 0 assigned" without asking for the store table.
 *
 * Regions are derived from the store code (db/25), so there is nothing to
 * create here: the list is fixed and the counts follow the import.
 */
export async function GET() {
  const me = await requireUserId()
  const rows = await asUser(me, async (db) => {
    const r = await db.execute(sql`
      select g.code, g.name, g.sort,
             count(s.id)                        as dokonlar,
             count(s.owner_id)                  as biriktirilgan,
             coalesce(
               (select string_agg(distinct u.full_name, ', ' order by u.full_name)
                  from stores s2 join users u on u.id = s2.owner_id
                 where s2.region_code = g.code and s2.active), '') as xodimlar
        from regions g
        left join stores s on s.region_code = g.code and s.active
       group by g.code, g.name, g.sort
       order by g.sort`)
    return r.rows
  })
  return NextResponse.json(rows, { headers: REF_CACHE })
}
