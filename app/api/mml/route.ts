import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { mmlSource } from '@/lib/sheets'

/**
 * MML — of what a store must carry, how much the last visit (or a hand-set
 * value) found. The must-list comes from the "Sotuv uchun" sheet: titles
 * required by name, plus shares of a category ("any 8 C titles"), each capped
 * at its target. See db/21 for the model.
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
             m.kerak, m.bor, m.yetishmaydi, m.mml,
             to_char(m.oxirgi_vizit, 'YYYY-MM-DD') oxirgi_vizit
        from v_mml m join stores s on s.id = m.store_id
       order by m.mml asc nulls last, m.yetishmaydi desc, m.store_id`)

    // The company number: one ratio over everything required, so a shop with
    // 57 required titles counts for more than one with 11. Stores nobody has
    // measured are left out, exactly as they are per store.
    const total = await db.execute(sql`
      select sum(kerak) filter (where oxirgi_vizit is not null or qolda_bor) kerak,
             sum(bor)   filter (where oxirgi_vizit is not null or qolda_bor) bor,
             round(100.0 * sum(bor) filter (where oxirgi_vizit is not null or qolda_bor)
                   / nullif(sum(kerak) filter (where oxirgi_vizit is not null or qolda_bor), 0), 1) mml,
             count(*) filter (where oxirgi_vizit is null and not qolda_bor) hech_borilmagan,
             count(*) filter (where oxirgi_vizit is not null or qolda_bor) borilgan
        from v_mml`)

    // titles required by name that are missing most often — the restocking list
    const books = await db.execute(sql`
      select book_id, title, book_category,
             count(*) kerak,
             count(*) filter (where not bor) yetishmaydi
        from v_mml_status
       where kind = 'nomma' and oxirgi_vizit is not null
       group by 1, 2, 3
       having count(*) filter (where not bor) > 0
       order by yetishmaydi desc, title`)

    // one store: its titles (named and share) and each share's target
    const detail = store
      ? await db.execute(sql`
          select book_id, title, book_category, kind, bor, qolda
            from v_mml_status where store_id = ${store}
           order by kind, bor, book_category nulls last, title`)
      : { rows: [] }
    const shares = store
      ? await db.execute(sql`
          select book_category, target, bor, hisob
            from v_mml_share where store_id = ${store}
           order by book_category`)
      : { rows: [] }

    const canEdit = await db.execute(sql`select can_manage_users() ok`)

    return {
      stores: stores.rows,
      total: total.rows[0],
      books: books.rows,
      detail: detail.rows,
      shares: shares.rows,
      canEdit: !!(canEdit.rows[0] as { ok: boolean }).ok,
      source: mmlSource(),   // which sheet and tabs the button will read
    }
  })

  return NextResponse.json(data)
}
