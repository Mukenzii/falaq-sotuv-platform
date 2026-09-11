import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { presignView, isConfigured, publicOriginFor } from '@/lib/minio'

/**
 * Redirects to a short-lived read link, but only for a key this person is
 * meant to see — the database decides, not the caller's guess.
 */
export async function GET(req: Request) {
  const me = await requireUserId()
  const key = new URL(req.url).searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key kerak' }, { status: 400 })
  if (!isConfigured()) return NextResponse.json({ error: 'MinIO sozlanmagan' }, { status: 503 })

  // Three legitimate owners of a key: a photo on a visit this person can see,
  // a file answering a "Fayl yuklash" question on such a visit (both decided by
  // RLS), or an illustration placed in the form itself, which every signed-in
  // user is meant to see. Anything else is a 404.
  const allowed = await asUser(me, async (db) => {
    const r = await db.execute(sql`
      select 1 from visit_photos where object_key = ${key}
      union all
      select 1 from form_image_keys() k where k = ${key}
      union all
      select 1 from visit_answers va
        cross join lateral jsonb_array_elements(va.value) f
       where jsonb_typeof(va.value) = 'array' and f ->> 'object_key' = ${key}
      limit 1`)
    return r.rows.length > 0
  })
  if (!allowed) return NextResponse.json({ error: 'topilmadi' }, { status: 404 })

  return NextResponse.redirect(presignView(key, publicOriginFor(req.headers.get('host'))))
}
