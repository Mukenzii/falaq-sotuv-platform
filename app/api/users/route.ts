import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asSystem, asUser, pgCode } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { Forbidden, Unauthorized, requireAdmin } from '@/lib/auth'
import { hashPassword, normalizeUsername, passwordProblem, usernameProblem } from '@/lib/password'

const ROLES = ['direktor', 'sotuv_boshligi', 'hudud_rahbari', 'sotuv_manager']

// GET has no role check on purpose: RLS decides, and u_read scopes the list.
// POST cannot work that way any more — the password is written over an owner
// connection, which bypasses policies — so it checks the role itself.

export async function GET() {
  const me = await requireUserId()
  const rows = await asUser(me, async (db) => {
    const r = await db.execute(sql`
      select u.id, u.username, u.telegram_id, u.telegram_username, u.full_name, u.phone,
             u.role, u.parent_id, u.active, p.full_name as parent_name,
             u.region_code, g.name as hudud,
             u.password_hash is not null as has_password, u.must_change_password,
             (select count(*) from stores s where s.owner_id = u.id and s.active) as dokonlar
        from users u
        left join users p on p.id = u.parent_id
        left join regions g on g.code = u.region_code
       order by u.role, u.full_name
    `)
    return r.rows
  })
  return NextResponse.json(rows)
}

/**
 * An administrator creating an account. This is the only way one is made:
 * there is no sign-up, and nobody joins by messaging a bot any more.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin()
  } catch (e) {
    if (e instanceof Unauthorized) return NextResponse.json({ error: 'Kirish kerak' }, { status: 401 })
    if (e instanceof Forbidden) return NextResponse.json({ error: 'Ruxsat yo‘q' }, { status: 403 })
    throw e
  }

  const b = await req.json()
  const login = normalizeUsername(b.username)
  const password = typeof b.password === 'string' ? b.password : ''

  if (!b.full_name?.trim()) {
    return NextResponse.json({ error: 'Ism kiritilishi shart' }, { status: 400 })
  }
  const badLogin = usernameProblem(login)
  if (badLogin) return NextResponse.json({ error: badLogin }, { status: 400 })
  const badPassword = passwordProblem(password)
  if (badPassword) return NextResponse.json({ error: badPassword }, { status: 400 })
  if (b.role && !ROLES.includes(b.role)) {
    return NextResponse.json({ error: 'Lavozim noto‘g‘ri' }, { status: 400 })
  }

  const hash = await hashPassword(password)

  try {
    // asSystem: password_hash is never written through the request role. The
    // role check above is what stands in for u_insert here.
    const row = await asSystem(async (db) => {
      const r = await db.execute(sql`
        insert into users (username, password_hash, must_change_password,
                           password_set_at, full_name, phone, role, parent_id, region_code)
        values (${login}, ${hash}, true, now(), ${b.full_name.trim()}, ${b.phone ?? null},
                ${b.role ?? 'sotuv_manager'}, ${b.parent_id ?? null}, ${b.region_code || null})
        returning id, username, full_name, role, parent_id, active, region_code
      `)
      return r.rows[0]
    })
    return NextResponse.json(row, { status: 201 })
  } catch (e: unknown) {
    if (pgCode(e) === '23505') {
      return NextResponse.json({ error: 'Bu login band' }, { status: 409 })
    }
    if (pgCode(e) === '23514') {
      return NextResponse.json({ error: 'Login noto‘g‘ri' }, { status: 400 })
    }
    if (pgCode(e) === '23503') {
      return NextResponse.json({ error: 'Bunday hudud yo‘q' }, { status: 400 })
    }
    throw e
  }
}
