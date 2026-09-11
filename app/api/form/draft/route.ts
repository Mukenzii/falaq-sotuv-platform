import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { errorResponse } from '@/lib/form/http'
import { sanitizeDoc } from '@/lib/form/sanitize'
import { validateDoc } from '@/lib/form/doc'

/**
 * Autosave. The editor sends the whole document plus the rev it started from.
 *
 * A stale rev means another admin saved in between, so this returns 409 with
 * their version attached instead of writing. Silently overwriting is the one
 * outcome that loses work without anyone finding out.
 */
export async function PUT(req: Request) {
  try {
    const user = await requireAdmin()
    const body = await req.json()
    const doc = sanitizeDoc(body?.doc)
    const baseRev = String(body?.rev ?? '')

    const out = await asUser(user.id, async (db) => {
      const cur = (await db.execute(sql`
        select id, rev::text, updated_at from form_versions where status = 'draft' limit 1`)).rows[0] as
        { id: number; rev: string; updated_at: string } | undefined
      if (!cur) return { missing: true as const }
      if (baseRev && baseRev !== cur.rev) return { conflict: true as const, cur }

      const r = await db.execute(sql`
        update form_versions
           set doc = ${JSON.stringify(doc)}::jsonb,
               rev = rev + 1,
               updated_at = now(),
               updated_by = ${user.id}
         where id = ${cur.id}
        returning id, version, status, rev::text, updated_at`)
      return { row: r.rows[0] }
    })

    if ('missing' in out) return NextResponse.json({ error: 'qoralama yo\'q' }, { status: 404 })
    if ('conflict' in out) {
      const server = await asUser(user.id, async (db) =>
        (await db.execute(sql`
          select id, version, status, rev::text, updated_at, doc,
                 (select full_name from users where id = form_versions.updated_by) as updated_by_name
            from form_versions where status = 'draft' limit 1`)).rows[0])
      return NextResponse.json(
        { error: 'Boshqa administrator formani o\'zgartirdi', conflict: true, server },
        { status: 409 },
      )
    }

    // warnings do not block a draft save — a half-built question is normal while
    // editing — but they are handed back so the editor can show them live
    return NextResponse.json({ ...out.row, issues: validateDoc(doc) })
  } catch (e) {
    return errorResponse(e)
  }
}
