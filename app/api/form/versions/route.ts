import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { errorResponse } from '@/lib/form/http'

/**
 * The forms this administrator can import questions from.
 *
 * This app holds one form, so its importable sources are its own published
 * versions — a real, unmodifiable source with real questions, which is what
 * "import from another form" needs. Importing reads a version and copies blocks
 * with fresh ids; nothing writes back, so a source can never be changed by it.
 */
export async function GET() {
  try {
    const user = await requireAdmin()
    const rows = await asUser(user.id, async (db) => {
      const r = await db.execute(sql`
        select id, version, status, updated_at, published_at,
               doc ->> 'title' as title,
               (select count(*) from jsonb_array_elements(doc -> 'sections') sec,
                       jsonb_array_elements(sec -> 'blocks') b
                 where b ->> 'kind' = 'question') as questions
          from form_versions
         where status in ('published', 'archived')
         order by version desc`)
      return r.rows
    })
    return NextResponse.json(rows)
  } catch (e) {
    return errorResponse(e)
  }
}
