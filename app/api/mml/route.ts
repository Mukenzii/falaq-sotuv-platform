import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { mmlSource } from '@/lib/sheets'

/**
 * MML — of the titles that must be in a store, how many the last visit found.
 *
 * Everything here reads the v_* views, which are security_invoker, so RLS
 * narrows it: a manager sees their own shops, a direktor sees all of them, and
 * the company figure each of them sees is the figure for their own patch.
 */
export async function GET(req: Request) {
  const me = await requireUserId()
  const store = new URL(req.url).searchParams.get('dokon')

  const data = await asUser(me, async (db) => {
    const stores = await db.execute(sql`
      select m.store_id, m.code, m.store_name, m.store_category, s.territory, s.store_type,
             m.kerak, m.bor, m.yetishmaydi, m.mml,
             to_char(m.oxirgi_vizit, 'YYYY-MM-DD') oxirgi_vizit
        from v_mml m join stores s on s.id = m.store_id
       order by m.mml asc nulls last, m.yetishmaydi desc, m.store_id`)

    // The company number: one ratio over every (store, required book) pair, so
    // a shop with 200 required titles counts for more than one with 8.
    // Stores nobody has visited are excluded, exactly as they are per store —
    // counting them as zero would report a shortfall nobody has observed.
    const total = await db.execute(sql`
      select sum(kerak) filter (where oxirgi_vizit is not null) kerak,
             sum(bor)   filter (where oxirgi_vizit is not null) bor,
             round(100.0 * sum(bor) filter (where oxirgi_vizit is not null)
                   / nullif(sum(kerak) filter (where oxirgi_vizit is not null), 0), 1) mml,
             count(*) filter (where oxirgi_vizit is null) hech_borilmagan,
             count(*) filter (where oxirgi_vizit is not null) borilgan
        from v_mml`)

    // which titles are missing most often — the restocking list
    const books = await db.execute(sql`
      select book_id, title, book_category,
             count(*) kerak,
             count(*) filter (where not bor) yetishmaydi
        from v_mml_status
       where oxirgi_vizit is not null
       group by 1, 2, 3
       having count(*) filter (where not bor) > 0
       order by yetishmaydi desc, title`)

    // One store's whole picture: every title, whether it is required here,
    // whether the last visit found it, and whether a human decided it. The
    // not-required ones are included so they can be put back with one click.
    const detail = store
      ? await db.execute(sql`
          select m.book_id, m.title, m.book_category, m.required, m.is_override,
                 coalesce(ss.present, vb.book_id is not null) as bor,
                 (ss.store_id is not null)                    as qolda
            from v_store_mml m
            left join v_store_last_visit lv on lv.store_id = m.store_id
            left join visit_books vb
                   on vb.visit_id = lv.visit_id and vb.book_id = m.book_id
                  and vb.status = 'present'
            left join store_stock ss on ss.store_id = m.store_id and ss.book_id = m.book_id
           where m.store_id = ${Number(store)}
           order by m.required desc, bor, m.book_category, m.title`)
      : { rows: [] }

    // whether this person may edit the list at all, so the page can say so
    const canEdit = await db.execute(sql`select can_manage_users() ok`)

    return {
      stores: stores.rows,
      total: total.rows[0],
      books: books.rows,
      detail: detail.rows,
      canEdit: !!(canEdit.rows[0] as { ok: boolean }).ok,
      source: mmlSource(),   // which sheet and tab the button will read
    }
  })

  return NextResponse.json(data)
}
