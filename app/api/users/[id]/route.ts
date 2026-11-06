import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgArray, pgCode, pgMessage } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { normalizeUsername, usernameProblem } from '@/lib/password.shared'
import { regionList } from '@/lib/regions'

type Ctx = { params: Promise<{ id: string }> }

// password_hash is deliberately absent and must stay absent: a password is set
// by POST /api/users/[id]/password, over an owner connection, after an explicit
// role check. Letting it through here would put it behind u_update, which lets
// a person edit their own row.
const FIELDS = ['username', 'full_name', 'phone', 'role', 'parent_id', 'active',
  // one region per manager (db/25). Assigning the region's shops is a separate
  // call to PATCH /api/stores — this column only records which region it was.
  // A hudud rahbari's regions are a list instead: `regions`, below (db/33).
  'region_code'] as const

/** Thrown inside the transaction so the half-done update rolls back with it. */
class OnlyHeads extends Error {}
class ForbiddenFields extends Error {}

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
  const regions = 'regions' in body ? regionList(body.regions) : undefined
  if (regions === null) return NextResponse.json({ error: 'Hududlar noto‘g‘ri' }, { status: 400 })
  if (!sets.length && !regions) {
    return NextResponse.json({ error: 'O‘zgartirish uchun hech narsa yo‘q' }, { status: 400 })
  }

  try {
    const row = await asUser(me, async (db) => {
      const permission = await db.execute(sql`select can_manage_users() as allowed`)
      const canManage = permission.rows[0]?.allowed === true
      // Reject the entire request rather than silently accepting protected fields.
      // db/32 also enforces this for callers that bypass this HTTP handler.
      if (!canManage && Object.keys(body).some((f) => f !== 'full_name' && f !== 'phone')) {
        throw new ForbiddenFields()
      }
      const cols = sql`id, username, full_name, role, parent_id, active, region_code`
      let u = (sets.length
        ? await db.execute(sql`update users set ${sql.join(sets, sql`, `)} where id = ${id} returning ${cols}`)
        : await db.execute(sql`select ${cols} from users where id = ${id}`)
      ).rows[0] as { role: string; region_code: string | null } | undefined
      if (!u) return undefined

      if (canManage && u.role === 'hudud_rahbari') {
        // A head's regions live in user_regions. One picked as their single
        // region — before they became a head, or by an older client — moves there.
        if (u.region_code) {
          await db.execute(sql`
            insert into user_regions (user_id, region_code) values (${id}, ${u.region_code})
            on conflict do nothing`)
          u = (await db.execute(sql`
            update users set region_code = null where id = ${id} returning ${cols}`)).rows[0] as typeof u
        }
        if (regions) {
          await db.execute(sql`delete from user_regions where user_id = ${id}`)
          if (regions.length) {
            await db.execute(sql`
              insert into user_regions (user_id, region_code)
              select ${id}, unnest(${pgArray(regions)}::text[])`)
          }
        }
      } else if (canManage) {
        if (regions?.length) throw new OnlyHeads()
        // someone who stops being a head stops running regions
        await db.execute(sql`delete from user_regions where user_id = ${id}`)
      }

      const g = await db.execute(sql`
        select coalesce(array_agg(region_code order by region_code), '{}') as regions
          from user_regions where user_id = ${id}`)
      return { ...u, regions: (g.rows[0] as { regions: string[] }).regions }
    })
    if (!row) return NextResponse.json({ error: 'Topilmadi yoki ruxsat yo‘q' }, { status: 404 })
    return NextResponse.json(row)
  } catch (e: unknown) {
    if (e instanceof ForbiddenFields) {
      return NextResponse.json({ error: 'O‘z hisobingizda faqat ism va telefonni o‘zgartira olasiz' }, { status: 403 })
    }
    if (e instanceof OnlyHeads) {
      return NextResponse.json({ error: 'Bir nechta hudud faqat hudud rahbariga beriladi' }, { status: 400 })
    }
    // guard_last_direktor raises a plain exception
    if (pgCode(e) === 'P0001') return NextResponse.json({ error: pgMessage(e) }, { status: 409 })
    // guard_own_row (db/32): someone without user rights touched more of their
    // own row than their name and phone
    if (pgCode(e) === '42501') return NextResponse.json({ error: pgMessage(e) }, { status: 403 })
    if (pgCode(e) === '23505') return NextResponse.json({ error: 'Bu login band' }, { status: 409 })
    if (pgCode(e) === '23514') return NextResponse.json({ error: 'Login noto‘g‘ri' }, { status: 400 })
    if (pgCode(e) === '23503') return NextResponse.json({ error: 'Bunday hudud yo‘q' }, { status: 400 })
    if (pgCode(e) === '42501') return NextResponse.json({ error: 'Ruxsat yo‘q' }, { status: 403 })
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
