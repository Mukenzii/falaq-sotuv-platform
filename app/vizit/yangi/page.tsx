import { redirect } from 'next/navigation'
import { currentUserId } from '@/lib/session'
import VisitForm from './Form'

/**
 * The form itself is a client component, so it cannot gate itself — logged out,
 * it used to render an empty shell whose fetches all quietly 401. Every other
 * page redirects, so this one does too.
 */
export default async function NewVisitPage() {
  if (!(await currentUserId())) redirect('/login')
  return <VisitForm />
}
