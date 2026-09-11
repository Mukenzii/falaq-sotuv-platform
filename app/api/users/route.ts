import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgCode } from '@/lib/db'
import { requireUserId } from '@/lib/session'

// No role check here on purpose: RLS decides. u_read scopes the list,
// u_insert rejects the write unless can_manage_users() is true.

export async function GET() {
  const me = await requireUserId()
  const rows = await asUser(me, async (db) => {
    const r = await db.execute(sql`
      select u.id, u.telegram_id, u.telegram_username, u.full_name, u.phone,
             u.role, u.parent_id, u.active, p.full_name as parent_name
        from users u
        left join users p on p.id = u.parent_id
       order by u.role, u.full_name
    `)
    return r.rows
  })
  return NextResponse.json(rows)
}

export async function POST(req: Request) {
  const me = await requireUserId()
  const b = await req.json()

  if (!b.telegram_id || !b.full_name) {
    return NextResponse.json({ error: 'Telegram ID va ism kiritilishi shart' }, { status: 400 })
  }

  try {
    const row = await asUser(me, async (db) => {
      const r = await db.execute(sql`
        insert into users (telegram_id, full_name, phone, role, parent_id)
        values (${b.telegram_id}, ${b.full_name}, ${b.phone ?? null},
                ${b.role ?? 'sotuv_manager'}, ${b.parent_id ?? null})
        returning id, telegram_id, full_name, role, parent_id, active
      `)
      return r.rows[0]
    })
    return NextResponse.json(row, { status: 201 })
  } catch (e: unknown) {
    if (pgCode(e) === '23505') {
      return NextResponse.json({ error: 'Bu Telegram hisobi allaqachon mavjud' }, { status: 409 })
    }
    if (pgCode(e) === '42501') {
      return NextResponse.json({ error: 'Ruxsat yo‘q' }, { status: 403 })
    }
    throw e
  }
}
