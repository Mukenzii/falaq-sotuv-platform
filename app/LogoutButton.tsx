'use client'

import { clearClientCache } from '@/lib/clientCache'

/**
 * A real form submit, so signing out still works with no JavaScript. The click
 * handler only wipes the cached lists on the way out — it never preventDefaults,
 * so the POST happens either way.
 */
export default function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="post" style={{ display: 'contents' }}>
      <button type="submit" className="btn btn-ghost btn-sm" onClick={() => clearClientCache()}>
        Chiqish
      </button>
    </form>
  )
}
