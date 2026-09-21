import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { currentUserId } from '@/lib/session'

export async function GET() {
  const me = await currentUserId()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const row = await asUser(me, async (db) => {
    const r = await db.execute(sql`
      select id, full_name, role, username, must_change_password
        from users where id = ${me}`)
    return r.rows[0]
  })
  return row ? NextResponse.json(row) : NextResponse.json({ error: 'gone' }, { status: 401 })
}
