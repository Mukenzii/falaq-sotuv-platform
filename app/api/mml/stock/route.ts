import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgCode } from '@/lib/db'
import { requireUserId } from '@/lib/session'

/**
 * Say whether a book is on the shelf, without waiting for a visit.
 *
 * This never touches visit_books. A visit is the record of what a manager saw
 * on a given day and an admin must not be able to edit it from an analytics
 * page; the hand-set value lives in store_stock and wins while it is there.
 * DELETE removes it, so the last visit speaks for the store again.
 */
async function body(req: Request) {
  const b = await req.json().catch(() => ({}))
  const store_id = Number(b.store_id)
  const book_id = Number(b.book_id)
  if (!Number.isSafeInteger(store_id) || !Number.isSafeInteger(book_id) || store_id <= 0 || book_id <= 0) {
    return null
  }
  return { store_id, book_id, present: !!b.present }
}

export async function PUT(req: Request) {
  const me = await requireUserId()
  const v = await body(req)
  if (!v) return NextResponse.json({ error: "do'kon yoki kitob noto'g'ri" }, { status: 400 })

  try {
    const row = await asUser(me, async (db) => {
      const r = await db.execute(sql`
        insert into store_stock (store_id, book_id, present, updated_by)
        values (${v.store_id}, ${v.book_id}, ${v.present}, ${me})
        on conflict (store_id, book_id) do update
          set present = excluded.present, updated_at = now(), updated_by = excluded.updated_by
        returning store_id, book_id, present`)
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

/** Forget the hand-set value; the last visit decides again. */
export async function DELETE(req: Request) {
  const me = await requireUserId()
  const v = await body(req)
  if (!v) return NextResponse.json({ error: "do'kon yoki kitob noto'g'ri" }, { status: 400 })

  try {
    const gone = await asUser(me, async (db) => {
      const r = await db.execute(sql`
        delete from store_stock where store_id = ${v.store_id} and book_id = ${v.book_id}
        returning store_id`)
      return r.rows.length > 0
    })
    return NextResponse.json({ ok: gone })
  } catch (e) {
    if (pgCode(e) === '42501') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
    throw e
  }
}
