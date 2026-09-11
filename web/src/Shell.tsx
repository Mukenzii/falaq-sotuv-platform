import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'

type Me = { full_name: string; role: string }

/**
 * The header the server used to render. Here it is a fetch: the page paints
 * immediately and the name arrives a moment later, which is the trade the
 * client-only build makes everywhere.
 *
 * A 401 means the session is gone, so the shell sends you to login rather than
 * leaving a signed-out page that half works.
 */
export default function Shell() {
  const [me, setMe] = useState<Me | null>(null)
  const nav = useNavigate()

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setMe)
      .catch(() => nav('/login', { replace: true }))
  }, [nav])

  async function logout() {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('falaq.cache.')) localStorage.removeItem(k) } catch { /* blocked */ }
    // the API answers with a 303 to /login; follow it ourselves so the SPA
    // router stays in charge of the URL
    await fetch('/api/auth/logout', { method: 'POST', redirect: 'manual' }).catch(() => {})
    nav('/login', { replace: true })
  }

  return (
    <>
      <a href="#main" className="skip">Asosiy qismga o&apos;tish</a>
      <header className="topbar">
        <a href="/" className="brand" style={{ color: 'inherit' }}>Falaq Sotuv</a>
        <span className="spacer" />
        <span className="who">{me ? me.full_name.split(' ')[0] : ''}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>Chiqish</button>
      </header>
      <Outlet />
    </>
  )
}
