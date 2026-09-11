import { redirect } from 'next/navigation'
import { currentUserId } from '@/lib/session'
import RejaClient from './Client'

// Everyone signed in may look: a manager needs to see their own week. RLS
// decides whose plans they actually get, and the editing controls are hidden
// unless can_manage_users() says otherwise.
export default async function RejaPage() {
  if (!(await currentUserId())) redirect('/login')
  return <RejaClient />
}
