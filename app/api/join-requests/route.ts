import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireUserId } from '@/lib/session'

// No role check here on purpose: RLS decides. jr_read is gated on
// can_manage_users(), so a manager simply sees an empty list.
export async function GET() {
  const me = await requireUserId()
  const rows = await asUser(me, async (db) => {
    const r = await db.execute(sql`
      select telegram_id, username, display_name, created_at
        from join_requests
       order by created_at`)
    return r.rows
  })
  return NextResponse.json(rows)
}
