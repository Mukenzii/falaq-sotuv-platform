import { redirect } from 'next/navigation'
import { me } from '@/lib/auth'
import SetupClient from './Client'

// The screen is a client component, so the gate lives here.
export default async function SozlashPage() {
  const u = await me()
  if (!u) redirect('/login')
  if (!u.isAdmin) redirect('/')
  return <SetupClient />
}
