import { sql } from 'drizzle-orm'
import { asUser } from './db'
import { currentUserId } from './session'

export const ADMIN_ROLES = ['direktor', 'sotuv_boshligi']

export type Me = {
  id: string; full_name: string; username: string | null; role: string
  isAdmin: boolean; mustChangePassword: boolean
}

/** The signed-in user with their role, or null. One query, used by every gate. */
export async function me(): Promise<Me | null> {
  const id = await currentUserId()
  if (!id) return null
  const row = await asUser(id, async (db) => {
    // password_hash is never selected here. It is read in exactly one place,
    // app/api/auth/login, over an owner connection.
    const r = await db.execute(sql`
      select full_name, username, role, must_change_password
        from users where id = ${id}`)
    return r.rows[0] as {
      full_name: string; username: string | null; role: string; must_change_password: boolean
    } | undefined
  })
  if (!row) return null
  return {
    id,
    full_name: row.full_name,
    username: row.username,
    role: row.role,
    isAdmin: ADMIN_ROLES.includes(row.role),
    mustChangePassword: row.must_change_password,
  }
}

/**
 * RLS already refuses an admin write from a manager, but a route that only
 * relies on that leaks the shape of the draft on the way in. Editor routes
 * check here first and RLS remains the backstop.
 */
export class Unauthorized extends Error {}
export class Forbidden extends Error {}

export async function requireAdmin(): Promise<Me> {
  const u = await me()
  if (!u) throw new Unauthorized()
  if (!u.isAdmin) throw new Forbidden()
  return u
}

export async function requireMe(): Promise<Me> {
  const u = await me()
  if (!u) throw new Unauthorized()
  return u
}
