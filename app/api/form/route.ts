import { NextResponse } from 'next/server'
import { REF_CACHE } from '@/lib/httpCache'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireAdmin, requireMe } from '@/lib/auth'
import { errorResponse } from '@/lib/form/http'

export type FormPayload = {
  id: number
  version: number
  status: 'draft' | 'published' | 'archived'
  rev: string
  updated_at: string
  published_at: string | null
  doc: unknown
}

/**
 * GET /api/form              the published form — what a respondent fills
 * GET /api/form?v=draft      the working copy — admin only
 * GET /api/form?v=7          one historical version — admin only
 *
 * A response viewer asks for the version the response was written under, which
 * is why archived versions stay readable rather than being deleted on publish.
 */
export async function GET(req: Request) {
  try {
    const want = new URL(req.url).searchParams.get('v') ?? 'published'
    const user = want === 'published' ? await requireMe() : await requireAdmin()

    const row = await asUser(user.id, async (db) => {
      const where =
        want === 'published' ? sql`status = 'published'`
        : want === 'draft' ? sql`status = 'draft'`
        : sql`version = ${Number(want)}`
      const r = await db.execute(sql`
        select id, version, status, rev::text, updated_at, published_at, doc
          from form_versions where ${where} limit 1`)
      return r.rows[0] as FormPayload | undefined
    })

    if (!row) return NextResponse.json({ error: 'forma topilmadi' }, { status: 404 })
    // Only the published form is worth caching; a draft is being edited.
    return NextResponse.json(row, want === 'published' ? { headers: REF_CACHE } : undefined)
  } catch (e) {
    return errorResponse(e)
  }
}
