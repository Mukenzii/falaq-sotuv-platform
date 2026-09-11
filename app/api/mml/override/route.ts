import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgCode } from '@/lib/db'
import { requireUserId } from '@/lib/session'

/**
 * Put one book in or out of one store's must-list.
 *
 * This writes an override, never the rule: changing the rule would move every
 * store of that category at once, which is not what someone clicking a single
 * chip is asking for. DELETE drops the override so the pair follows the rule
 * again — that is "reset", not "remove from the list".
 *
 * RLS (mo_write -> can_manage_users) is the actual gate; a manager gets a 403.
 */
async function ids(req: Request) {
  const b = await req.json().catch(() => ({}))
  const store_id = Number(b.store_id)
  const book_id = Number(b.book_id)
  if (!Number.isSafeInteger(store_id) || !Number.isSafeInteger(book_id) || store_id <= 0 || book_id <= 0) {
    return null
  }
  return { store_id, book_id, required: !!b.required }
}

export async function PATCH(req: Request) {
  const me = await requireUserId()
  const v = await ids(req)
  if (!v) return NextResponse.json({ error: "do'kon yoki kitob noto'g'ri" }, { status: 400 })

  try {
    const row = await asUser(me, async (db) => {
      const r = await db.execute(sql`
        insert into mml_overrides (store_id, book_id, required, note)
        values (${v.store_id}, ${v.book_id}, ${v.required}, 'qo''lda o''zgartirilgan')
        on conflict (store_id, book_id) do update
          set required = excluded.required, note = excluded.note
        returning store_id, book_id, required`)
      return r.rows[0]
    })
    if (!row) return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
    return NextResponse.json(row)
  } catch (e) {
    if (pgCode(e) === '42501') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
    if (pgCode(e) === '23503') return NextResponse.json({ error: 'topilmadi' }, { status: 404 })
    throw e
  }
}

/** Drop the override: the pair goes back to whatever the rule says. */
export async function DELETE(req: Request) {
  const me = await requireUserId()
  const v = await ids(req)
  if (!v) return NextResponse.json({ error: "do'kon yoki kitob noto'g'ri" }, { status: 400 })

  try {
    const gone = await asUser(me, async (db) => {
      const r = await db.execute(sql`
        delete from mml_overrides
         where store_id = ${v.store_id} and book_id = ${v.book_id}
        returning store_id`)
      return r.rows.length > 0
    })
    // Nothing deleted is either "no override" or "not allowed"; RLS makes them
    // the same answer on purpose, and the client re-reads either way.
    return NextResponse.json({ ok: gone })
  } catch (e) {
    if (pgCode(e) === '42501') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
    throw e
  }
}
