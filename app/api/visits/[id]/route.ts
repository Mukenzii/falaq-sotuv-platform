import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { deleteObjects } from '@/lib/minio'
import { pushSheetsSoon } from '@/lib/sheetsSync'

type Ctx = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Visit = {
  id: string; store_id: string; store_code: string
  manager_id: string; manager: string; visited_at: string
}

/**
 * Remove a filed visit. Admins only — db/22 grants the delete to
 * can_manage_users() and to nobody else, so RLS refuses this even if the check
 * below were missing.
 *
 * Deleting is the last resort, not an edit: a manager who filed the wrong
 * numbers has 24 hours to correct them (v_update). What this is for is the
 * visit that should not exist at all — filed against the wrong shop, entered
 * twice, or left over from a demo.
 *
 * Three things go with the row, in this order:
 *   1. the child rows (books, photos, answers) — explicitly, not by cascade,
 *      so the delete is visible to RLS instead of happening underneath it;
 *   2. the audit row, written last so a rolled-back delete leaves no trace of
 *      a deletion that never happened;
 *   3. the photo files and the spreadsheet, after the transaction commits.
 */
export async function DELETE(req: Request, { params }: Ctx) {
  const me = await requireUserId()
  const { id } = await params
  // an id that cannot name a row and a row you may not see get the same answer
  if (!UUID.test(id)) return NextResponse.json({ error: 'topilmadi' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const raw = typeof body.sabab === 'string' ? body.sabab.trim() : ''
  const reason = raw ? raw.slice(0, 500) : null

  const out = await asUser(me, async (db) => {
    const admin = await db.execute(sql`select can_manage_users() ok`)
    if (!(admin.rows[0] as { ok: boolean }).ok) return 'forbidden' as const

    // read everything the log needs while the rows are still there; RLS hides
    // visits outside this person's branch, so "not found" covers both cases
    const found = await db.execute(sql`
      select v.id, v.store_id, v.manager_id, v.visited_at, s.code store_code, u.full_name manager
        from visits v
        join stores s on s.id = v.store_id
        join users  u on u.id = v.manager_id
       where v.id = ${id}`)
    const v = found.rows[0] as Visit | undefined
    if (!v) return 'missing' as const

    // Every file this visit owns: the photo strip, plus anything answered to a
    // file_upload question, which is stored as a jsonb array of {object_key}.
    // jsonb_exists() rather than the ? operator, which a driver may read as a
    // placeholder.
    const files = await db.execute(sql`
      select object_key from visit_photos where visit_id = ${id}
       union
      select e->>'object_key' as object_key
        from visit_answers a
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(a.value) = 'array' then a.value else '[]'::jsonb end) e
       where a.visit_id = ${id} and jsonb_exists(e, 'object_key')`)

    await db.execute(sql`delete from visit_answers where visit_id = ${id}`)
    await db.execute(sql`delete from visit_books   where visit_id = ${id}`)
    await db.execute(sql`delete from visit_photos  where visit_id = ${id}`)
    const gone = await db.execute(sql`delete from visits where id = ${id} returning id`)
    // can_manage_users() said yes and the row was visible a moment ago, so this
    // is unreachable — and if it ever is reached, the throw takes the child
    // rows back with it rather than leaving a half-deleted visit
    if (!gone.rows.length) throw new Error('visit delete removed nothing')

    await db.execute(sql`
      insert into deleted_visits
        (visit_id, store_id, store_code, manager_id, manager, visited_at, reason, deleted_by)
      values (${v.id}::uuid, ${v.store_id}::bigint, ${v.store_code}, ${v.manager_id}::uuid,
              ${v.manager}, ${v.visited_at}::timestamptz, ${reason}, ${me}::uuid)
      on conflict (visit_id) do nothing`)

    return {
      store_id: v.store_id,
      keys: files.rows.map((r) => (r as { object_key: string }).object_key).filter(Boolean),
    }
  })

  if (out === 'forbidden') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
  if (out === 'missing') return NextResponse.json({ error: 'topilmadi' }, { status: 404 })

  // After the commit: the visit is gone whatever these two do. A photo left
  // behind wastes disk, and the spreadsheet is rewritten from scratch on every
  // push, so the deleted row disappears from it without anything else.
  void deleteObjects(out.keys).catch(() => {})
  pushSheetsSoon()

  return NextResponse.json({ deleted: true, store_id: out.store_id, photos: out.keys.length })
}
