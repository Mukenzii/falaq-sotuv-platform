'use client'

import { useState } from 'react'
import { MIN_PASSWORD } from '@/lib/password.shared'

export default function ParolClient({ name, login }: { name: string; login: string }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const mismatch = again.length > 0 && next !== again
  const ready = current && next.length >= MIN_PASSWORD && next === again && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const r = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current, next }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error ?? 'Saqlanmadi'); setBusy(false); return }
      location.href = '/'
    } catch {
      setErr('Ulanib bo‘lmadi. Internetni tekshiring.')
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form className="card" onSubmit={submit}>
        <h1>Parolni o‘zgartiring</h1>
        <p className="sub">
          {name}, hozirgi parolingizni administrator bergan. Davom etishdan oldin
          o‘zingiz bilgan parolni qo‘ying.
        </p>

        {login && (
          <p className="hint" style={{ textAlign: 'left', marginTop: 0, marginBottom: 18 }}>
            Loginingiz: <b>{login}</b> — u o‘zgarmaydi.
          </p>
        )}

        {/* The browser is told which field is which, so a password manager
            offers to replace the temporary one rather than save it. */}
        <input type="text" name="username" autoComplete="username" value={login}
               readOnly hidden aria-hidden="true" />

        <div className="field" style={{ textAlign: 'left', marginBottom: 16 }}>
          <div className="lblrow">
            <label htmlFor="current">Hozirgi parol</label>
            {/* One toggle for all three boxes: checking that the new password
                matches is the whole job of this screen. */}
            <button type="button" className="linkbtn" onClick={() => setShow(!show)}>
              {show ? 'Parollarni yashirish' : 'Parollarni ko‘rsatish'}
            </button>
          </div>
          <input id="current" type={show ? 'text' : 'password'} value={current} autoFocus
                 autoComplete="current-password" required
                 onChange={(e) => setCurrent(e.target.value)} />
        </div>

        <div className="field" style={{ textAlign: 'left', marginBottom: 16 }}>
          <label htmlFor="next">Yangi parol</label>
          <input id="next" type={show ? 'text' : 'password'} value={next}
                 autoComplete="new-password" required minLength={MIN_PASSWORD}
                 onChange={(e) => setNext(e.target.value)} />
          <p className="hint" style={{ margin: '4px 0 0' }}>
            Kamida {MIN_PASSWORD} ta belgi.
          </p>
        </div>

        <div className={`field${mismatch ? ' has-err' : ''}`} style={{ textAlign: 'left', marginBottom: 20 }}>
          <label htmlFor="again">Yangi parol yana bir bor</label>
          <input id="again" type={show ? 'text' : 'password'} value={again}
                 autoComplete="new-password" required
                 onChange={(e) => setAgain(e.target.value)} />
          {mismatch && <p className="fielderr">Parollar bir xil emas</p>}
        </div>

        <button className="btn" style={{ width: '100%' }} type="submit" disabled={!ready}>
          {busy ? 'Saqlanmoqda…' : 'Saqlash va davom etish'}
        </button>

        {err && <div className="alert err" style={{ marginTop: 16, marginBottom: 0 }} aria-live="polite">{err}</div>}
      </form>
    </main>
  )
}
