import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgCode, pgMessage } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { normalizeUsername, usernameProblem } from '@/lib/password.shared'

type Ctx = { params: Promise<{ id: string }> }

// password_hash is deliberately absent and must stay absent: a password is set
// by POST /api/users/[id]/password, over an owner connection, after an explicit
// role check. Letting it through here would put it behind u_update, which lets
// a person edit their own row.
const FIELDS = ['username', 'full_name', 'phone', 'role', 'parent_id', 'active',
  // one region per person (db/25). Assigning the region's shops is a separate
  // call to PATCH /api/stores — this column only records which region it was.
  'region_code'] as const

export async function PATCH(req: Request, { params }: Ctx) {
  const me = await requireUserId()
  const { id } = await params
  const body = await req.json()

  // A login is stored lowercase, always: users_username_key is unique on
  // lower(username), so "Sardor" and "sardor" would otherwise collide in a way
  // the shape check never explains.
  if ('username' in body) {
    body.username = normalizeUsername(body.username)
    const bad = usernameProblem(body.username)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
  }

  const sets = FIELDS.filter((f) => f in body).map((f) => sql`${sql.identifier(f)} = ${body[f]}`)
  if (!sets.length) return NextResponse.json({ error: 'O‘zgartirish uchun hech narsa yo‘q' }, { status: 400 })

  try {
    const row = await asUser(me, async (db) => {
      const r = await db.execute(sql`
        update users set ${sql.join(sets, sql`, `)} where id = ${id}
        returning id, username, full_name, role, parent_id, active, region_code
      `)
      return r.rows[0]
    })
    if (!row) return NextResponse.json({ error: 'Topilmadi yoki ruxsat yo‘q' }, { status: 404 })
    return NextResponse.json(row)
  } catch (e: unknown) {
    // guard_last_direktor and guard_self_update both raise plain exceptions
    if (pgCode(e) === 'P0001') return NextResponse.json({ error: pgMessage(e) }, { status: 409 })
    if (pgCode(e) === '23505') return NextResponse.json({ error: 'Bu login band' }, { status: 409 })
    if (pgCode(e) === '23514') return NextResponse.json({ error: 'Login noto‘g‘ri' }, { status: 400 })
    if (pgCode(e) === '23503') return NextResponse.json({ error: 'Bunday hudud yo‘q' }, { status: 400 })
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
