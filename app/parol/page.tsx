import { redirect } from 'next/navigation'
import { me } from '@/lib/auth'
import ParolClient from './Client'

/**
 * Picking your own password after an administrator handed you one.
 *
 * middleware.ts sends people here from a cookie, and this page is the one that
 * asks the database. When the two disagree — the flag has been cleared but the
 * browser still carries the cookie — going straight home is a redirect loop,
 * because middleware would bounce them right back. A server component cannot
 * delete a cookie mid-render, so the way out is a route that can.
 */
export default async function ParolPage() {
  const u = await me()
  if (!u) redirect('/login')
  if (!u.mustChangePassword) redirect('/api/auth/pwchange-clear')
  return <ParolClient name={u.full_name} login={u.username ?? ''} />
}
