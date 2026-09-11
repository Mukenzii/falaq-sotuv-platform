import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { REF_CACHE } from '@/lib/httpCache'

export async function GET() {
  const me = await requireUserId()
  const rows = await asUser(me, async (db) => {
    const r = await db.execute(sql`select id, title from books where active order by title`)
    return r.rows
  })
  return NextResponse.json(rows, { headers: REF_CACHE })
}
