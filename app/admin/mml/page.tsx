import { redirect } from 'next/navigation'
import { currentUserId } from '@/lib/session'
import MmlClient from './Client'

// Any signed-in person may look: a manager needs to know what belongs on their
// own shelves. RLS decides whose shops they actually see.
export default async function MmlPage() {
  if (!(await currentUserId())) redirect('/login')
  return <MmlClient />
}
