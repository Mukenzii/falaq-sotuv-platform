import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import type { MmlTitle } from '@/lib/mml'

/**
 * One shop's must-list, for the agent standing in it: every required and
 * optional title with whether it is on the shelf, the shop's MML and the
 * required titles that are missing. The visit form recomputes the score live
 * from `titles` as titles are ticked (lib/mml.ts), by the rule v_mml uses.
 *
 * `holat` is v_mml's (db/35): ustun_yoq, qoida_eskirgan, majburiy_yoq,
 * olchanmagan or olchangan. Only "olchangan" carries an MML; the others say
 * why there is none, so a shop never just shows nothing.
 *
 * Any signed-in person may ask — what a shop must carry is no secret, and the
 * views read as the caller (security_invoker), as /api/mml does.
 */
export async function GET(req: Request) {
  let me: string
  try { me = await requireUserId() } catch { return NextResponse.json({ error: 'kirish kerak' }, { status: 401 }) }
  const raw = new URL(req.url).searchParams.get('id')
  if (!raw || !/^\d+$/.test(raw)) return NextResponse.json({ error: "do'kon tanlanmagan" }, { status: 400 })
  const id = Number(raw)

  const data = await asUser(me, async (db) => {
    const store = (await db.execute(sql`
      select store_id, code, store_name, store_category as mml_column,
             kerak, bor, yetishmaydi, mml, holat
        from v_mml where store_id = ${id}`)).rows[0] as
      { store_id: string; code: string; store_name: string; mml_column: string | null
        kerak: number; bor: number; yetishmaydi: number; mml: string | null; holat: string } | undefined
    if (!store) return null
    const titles = (await db.execute(sql`
      select book_id, title, book_category, kind, bor, qolda
        from v_mml_status where store_id = ${id}
       order by kind, bor, book_category nulls last, title`)).rows as MmlTitle[]
    return { store, titles }
  })

  if (!data) return NextResponse.json({ error: 'topilmadi' }, { status: 404 })
  const { store, titles } = data
  return NextResponse.json({
    store: { store_id: store.store_id, code: store.code, store_name: store.store_name, mml_column: store.mml_column },
    holat: store.holat,
    kerak: store.kerak,
    bor: store.bor,
    mml: store.mml === null ? null : Number(store.mml),
    titles,
    // what is missing is only worth saying once someone has looked
    missing: store.holat === 'olchangan'
      ? titles.filter((t) => t.kind === 'majburiy' && !t.bor)
          .map((t) => ({ book_id: t.book_id, title: t.title, book_category: t.book_category }))
      : [],
  })
}
