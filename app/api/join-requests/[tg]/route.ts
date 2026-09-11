import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgCode, pgMessage } from '@/lib/db'
import { requireUserId } from '@/lib/session'

const ROLES = ['direktor', 'sotuv_boshligi', 'hudud_rahbari', 'sotuv_manager']

/** Approve: turn the request into a real user, in one transaction with its removal. */
export async function POST(req: Request, { params }: { params: Promise<{ tg: string }> }) {
  const me = await requireUserId()
  const { tg } = await params
  const b = await req.json()

  if (!/^\d+$/.test(tg)) return NextResponse.json({ error: 'bad telegram id' }, { status: 400 })
  if (!b.full_name?.trim()) return NextResponse.json({ error: 'Ism kiritilmagan' }, { status: 400 })
  if (b.role && !ROLES.includes(b.role)) {
    return NextResponse.json({ error: 'bad role' }, { status: 400 })
  }

  try {
    const row = await asUser(me, async (db) => {
      // The request row is the only proof this id ever asked. Deleting it
      // inside the same transaction means a failed insert leaves it in place
      // rather than losing the person entirely.
      const found = await db.execute(sql`
        delete from join_requests where telegram_id = ${tg} returning username`)
      if (!found.rows.length) return null

      const r = await db.execute(sql`
        insert into users (telegram_id, telegram_username, full_name, role, parent_id)
        values (${tg}, ${(found.rows[0] as { username: string | null }).username},
                ${b.full_name.trim()}, ${b.role ?? 'sotuv_manager'}, ${b.parent_id || null})
        returning id, telegram_id, full_name, role, parent_id, active`)
      return r.rows[0]
    })

    if (!row) return NextResponse.json({ error: 'so‘rov topilmadi' }, { status: 404 })
    return NextResponse.json(row, { status: 201 })
  } catch (e: unknown) {
    if (pgCode(e) === '23505') {
      return NextResponse.json({ error: 'bu hisob allaqachon qo‘shilgan' }, { status: 409 })
    }
    if (pgCode(e) === '42501') return NextResponse.json({ error: 'ruxsat yo‘q' }, { status: 403 })
    return NextResponse.json({ error: pgMessage(e) }, { status: 400 })
  }
}

/** Dismiss without creating anyone. They can ask again by messaging the bot. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ tg: string }> }) {
  const me = await requireUserId()
  const { tg } = await params
  if (!/^\d+$/.test(tg)) return NextResponse.json({ error: 'bad telegram id' }, { status: 400 })

  const gone = await asUser(me, async (db) => {
    const r = await db.execute(sql`delete from join_requests where telegram_id = ${tg} returning telegram_id`)
    return r.rows.length > 0
  })
  return gone
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'so‘rov topilmadi' }, { status: 404 })
}
