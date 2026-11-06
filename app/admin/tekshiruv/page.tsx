import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { ADMIN_ROLES } from '@/lib/auth'
import { currentUserId } from '@/lib/session'
import SelfTestClient from './Client'

export default async function SelfTestPage() {
  const me = await currentUserId()
  if (!me) redirect('/login')
  const data = await asUser(me, async (db) => {
    const role = (await db.execute(sql`select role from users where id = ${me}`)).rows[0] as
      { role?: string } | undefined
    const regions = (await db.execute(sql`select code, name from regions order by sort`)).rows as
      Array<{ code: string; name: string }>
    return { role: role?.role, regions }
  })
  // the test creates and deletes rows system-wide, so only those who may do both
  if (!data.role || !ADMIN_ROLES.includes(data.role)) redirect('/')
  return <SelfTestClient regions={data.regions} />
}
