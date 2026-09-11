import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgCode, pgMessage } from '@/lib/db'
import { requireUserId } from '@/lib/session'

type Ctx = { params: Promise<{ id: string }> }

const FIELDS = ['telegram_id', 'full_name', 'phone', 'role', 'parent_id', 'active'] as const

export async function PATCH(req: Request, { params }: Ctx) {
  const me = await requireUserId()
  const { id } = await params
  const body = await req.json()

  const sets = FIELDS.filter((f) => f in body).map((f) => sql`${sql.identifier(f)} = ${body[f]}`)
  if (!sets.length) return NextResponse.json({ error: 'O‘zgartirish uchun hech narsa yo‘q' }, { status: 400 })

  try {
    const row = await asUser(me, async (db) => {
      const r = await db.execute(sql`
        update users set ${sql.join(sets, sql`, `)} where id = ${id}
        returning id, telegram_id, full_name, role, parent_id, active
      `)
      return r.rows[0]
    })
    if (!row) return NextResponse.json({ error: 'Topilmadi yoki ruxsat yo‘q' }, { status: 404 })
    return NextResponse.json(row)
  } catch (e: unknown) {
    // guard_last_direktor raises a plain exception
    if (pgCode(e) === 'P0001') return NextResponse.json({ error: pgMessage(e) }, { status: 409 })
    if (pgCode(e) === '23505') return NextResponse.json({ error: 'Bu Telegram hisobi allaqachon mavjud' }, { status: 409 })
    throw e
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const me = await requireUserId()
  const { id } = await params

  try {
    const row = await asUser(me, async (db) => {
      const r = await db.execute(sql`delete from users where id = ${id} returning id`)
      return r.rows[0]
    })
    if (!row) return NextResponse.json({ error: 'Topilmadi yoki ruxsat yo‘q' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    if (pgCode(e) === 'P0001') return NextResponse.json({ error: pgMessage(e) }, { status: 409 })
    if (pgCode(e) === '23503') {
      return NextResponse.json(
        { error: 'Bu xodimning vizitlari bor. O‘chirib bo‘lmaydi — uni faolsizlantiring.' },
        { status: 409 },
      )
    }
    throw e
  }
}
