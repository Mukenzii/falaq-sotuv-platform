import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { mmlSource } from '@/lib/sheets'

/**
 * MML — of the titles a store must carry, how many the last visit (or a
 * hand-set value) found. The must-list comes from the "Sotuv uchun" matrix:
 * 1 = required, 2 = optional, and only required titles count (db/35).
 *
 * Every active store is listed, with `holat` saying why one has no MML — no
 * matrix column for its type, nothing required, an unconverted old rule, not
 * measured yet — instead of leaving it out.
 *
 * Everything reads the v_* views, which are security_invoker, so RLS applies.
 */
export async function GET(req: Request) {
  const me = await requireUserId()
  const raw = new URL(req.url).searchParams.get('dokon')
  const store = raw && /^\d+$/.test(raw) ? Number(raw) : null

  const data = await asUser(me, async (db) => {
    const stores = await db.execute(sql`
      select m.store_id, m.code, m.store_name, m.store_category, s.territory, s.store_type,
             m.kerak, m.bor, m.yetishmaydi, m.mml, m.holat,
             to_char(m.oxirgi_vizit, 'YYYY-MM-DD') oxirgi_vizit
        from v_mml m join stores s on s.id = m.store_id
       order by m.mml asc nulls last, m.yetishmaydi desc, m.store_id`)

    // The company number: one ratio over everything required, so a shop with
    // 57 required titles counts for more than one with 11. Only measured
    // stores count, exactly as per store.
    const total = await db.execute(sql`
      select sum(kerak) filter (where holat = 'olchangan') kerak,
             sum(bor)   filter (where holat = 'olchangan') bor,
             round(100.0 * sum(bor) filter (where holat = 'olchangan')
                   / nullif(sum(kerak) filter (where holat = 'olchangan'), 0), 1) mml,
             count(*) filter (where holat = 'olchanmagan') hech_borilmagan,
             count(*) filter (where holat = 'olchangan') borilgan,
             count(*) filter (where holat in ('majburiy_yoq', 'ustun_yoq')) talabsiz,
             count(*) filter (where holat = 'qoida_eskirgan') eskirgan
        from v_mml`)

    // required titles missing most often in measured stores — the restocking list
    const books = await db.execute(sql`
      select book_id, title, book_category,
             count(*) kerak,
             count(*) filter (where not bor) yetishmaydi
        from v_mml_status
       where kind = 'majburiy'
         and store_id in (select store_id from v_mml where holat = 'olchangan')
       group by 1, 2, 3
       having count(*) filter (where not bor) > 0
       order by yetishmaydi desc, title`)

    // one store: its required and optional titles, each on the shelf or not
    const detail = store
      ? await db.execute(sql`
          select book_id, title, book_category, kind, bor, qolda
            from v_mml_status where store_id = ${store}
           order by kind, bor, book_category nulls last, title`)
      : { rows: [] }

    const canEdit = await db.execute(sql`select can_manage_users() ok`)

    return {
      stores: stores.rows,
      total: total.rows[0],
      books: books.rows,
      detail: detail.rows,
      canEdit: !!(canEdit.rows[0] as { ok: boolean }).ok,
      source: mmlSource(),   // which sheet and tabs the button will read
    }
  })

  return NextResponse.json(data)
}
