import { useState } from 'react'

/**
 * The same form as app/login/Client.tsx. Kept in step by hand — the two builds
 * do not share a module yet, and this is the second thing to have been
 * duplicated after globals.css. This is the copy people actually see:
 * nginx serves /login from this bundle (web/default.conf.template).
 */
const clearClientCache = () => {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('falaq.cache.')) localStorage.removeItem(k)
  } catch { /* private mode or blocked storage: nothing to clear */ }
}

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
      clearClientCache()
      // everything past the login screen is the Next app, so this has to be a
      // real page load and not a router push
      location.replace(j.next ?? '/')
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
