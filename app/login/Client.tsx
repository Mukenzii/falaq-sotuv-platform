'use client'

import { useState } from 'react'
import { clearClientCache } from '@/lib/clientCache'

/**
 * A login and a password. Accounts are made by an administrator — there is no
 * sign-up, and deliberately no "forgot my password": somebody locked out asks
 * their admin, who resets it on /admin/users.
 *
 * Kept in step by hand with web/src/pages/Login.tsx, which is the copy nginx
 * actually serves at /login in production.
 */
export default function Login() {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login, password }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error ?? 'Kirish amalga oshmadi'); setBusy(false); return }
      clearClientCache()            // a different person may be signing in here
      location.href = j.next ?? '/'
    } catch {
      setErr('Ulanib bo‘lmadi. Internetni tekshiring.')
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form className="card" onSubmit={submit}>
        <h1>Falaq Sotuv</h1>
        <p className="sub">Login va parolingiz bilan kiring</p>

        <div className="field" style={{ textAlign: 'left', marginBottom: 16 }}>
          <label htmlFor="login">Login</label>
          <input id="login" name="login" type="text" value={login} autoFocus
                 autoComplete="username" autoCapitalize="none" autoCorrect="off"
                 spellCheck={false} required
                 onChange={(e) => setLogin(e.target.value)} />
        </div>

        <div className="field" style={{ textAlign: 'left', marginBottom: 20 }}>
          <div className="lblrow">
            <label htmlFor="password">Parol</label>
            {/* Typing a password handed to you on paper, on a phone, in a shop:
                being able to see it is the difference between one try and five. */}
            <button type="button" className="linkbtn" onClick={() => setShow(!show)}>
              {show ? 'Yashirish' : 'Ko‘rsatish'}
            </button>
          </div>
          <input id="password" name="password" type={show ? 'text' : 'password'}
                 value={password} autoComplete="current-password" required
                 onChange={(e) => setPassword(e.target.value)} />
        </div>

        <button className="btn" style={{ width: '100%' }} type="submit"
                disabled={busy || !login || !password}>
          {busy ? 'Kirilmoqda…' : 'Kirish'}
        </button>

        {err && <div className="alert err" style={{ marginTop: 16, marginBottom: 0 }} aria-live="polite">{err}</div>}

        <p className="hint" style={{ marginTop: 14 }}>
          Login va parolni administrator beradi. Parolni unutgan bo‘lsangiz, unga murojaat qiling.
        </p>
      </form>
    </main>
  )
}
