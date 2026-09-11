import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { currentUserId } from '@/lib/session'
import SheetsClient from './Client'

export default async function SheetsPage() {
  const me = await currentUserId()
  if (!me) redirect('/login')
  const role = await asUser(me, async (db) => {
    const r = await db.execute(sql`select role from users where id = ${me}`)
    return (r.rows[0] as { role?: string } | undefined)?.role
  })
  if (role === 'sotuv_manager') redirect('/')
  return <SheetsClient />
}
