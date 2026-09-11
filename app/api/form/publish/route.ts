import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { errorResponse } from '@/lib/form/http'
import { errorsOnly, validateDoc } from '@/lib/form/doc'
import type { FormDoc } from '@/lib/form/types'

/**
 * Promotes the draft to published.
 *
 * The previous published version is archived rather than dropped: responses
 * point at a version number, and the viewer reads that version's document to
 * label them. Deleting it would leave old responses as bare ids.
 */
export async function POST(req: Request) {
  try {
    const user = await requireAdmin()
    const body = await req.json().catch(() => ({}))
    const baseRev = String(body?.rev ?? '')

    const out = await asUser(user.id, async (db) => {
      const draft = (await db.execute(sql`
        select id, version, rev::text, doc from form_versions where status = 'draft' limit 1`)).rows[0] as
        { id: number; version: number; rev: string; doc: FormDoc } | undefined
      if (!draft) return { missing: true as const }
      if (baseRev && baseRev !== draft.rev) return { conflict: true as const }

      const issues = validateDoc(draft.doc)
      const errors = errorsOnly(issues)
      if (errors.length) return { invalid: true as const, issues }

      // order matters: the partial unique indexes allow one draft and one
      // published row at a time, and they are checked per statement
      await db.execute(sql`update form_versions set status = 'archived' where status = 'published'`)
      await db.execute(sql`
        update form_versions set status = 'published', published_at = now(), updated_by = ${user.id}
         where id = ${draft.id}`)
      const nextVersion = (await db.execute(sql`
        select coalesce(max(version), 0) + 1 as v from form_versions`)).rows[0] as { v: number }
      const fresh = (await db.execute(sql`
        insert into form_versions (version, status, doc, updated_by)
        values (${nextVersion.v}, 'draft', ${JSON.stringify(draft.doc)}::jsonb, ${user.id})
        returning id, version, status, rev::text, updated_at`)).rows[0]

      // Versions accumulate one row per publish. An archived version is only
      // worth keeping while a response still points at it (or while it is
      // recent enough to import from); the rest are dead weight.
      await db.execute(sql`
        delete from form_versions
         where status = 'archived'
           and version not in (select distinct form_version from visits where form_version is not null)
           and version < (select max(version) - 20 from form_versions)`)

      return { published: draft.version, draft: fresh, issues }
    })

    if ('missing' in out) return NextResponse.json({ error: 'qoralama yo\'q' }, { status: 404 })
    if ('conflict' in out) {
      return NextResponse.json({ error: 'Qoralama o\'zgargan — sahifani yangilang', conflict: true }, { status: 409 })
    }
    if ('invalid' in out) {
      return NextResponse.json({ error: 'Formada xatolar bor', issues: out.issues }, { status: 422 })
    }
    return NextResponse.json(out)
  } catch (e) {
    return errorResponse(e)
  }
}
