import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { currentUserId } from '@/lib/session'
import UsersClient from './Client'

// The table is a client component, so the gate lives here.
export default async function UsersPage() {
  const me = await currentUserId()
  if (!me) redirect('/login')
  const role = await asUser(me, async (db) => {
    const r = await db.execute(sql`select role from users where id = ${me}`)
    return (r.rows[0] as { role?: string } | undefined)?.role
  })
  if (role !== 'direktor' && role !== 'sotuv_boshligi') redirect('/')
  return <UsersClient />
}
