'use client'

import { useEffect, useState } from 'react'

type Info = {
  configured: boolean
  problem: string | null
  sheet: { id: string; url: string } | null
  visits: string; visit_books: string; oxirgi: string | null
  dirty: boolean; last_ok_at: string | null; last_error: string | null; paused: boolean
}

export default function SheetsClient() {
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null)

  useEffect(() => { fetch('/api/sync/sheets').then((r) => r.json()).then(setInfo) }, [])

  async function sync() {
    setBusy(true); setMsg(null)
    const r = await fetch('/api/sync/sheets', { method: 'POST' })
    const j = await r.json()
    setBusy(false)
    fetch('/api/sync/sheets').then((r) => r.json()).then(setInfo)
    setMsg(r.ok
      ? { t: 'ok', m: `Yuborildi — ${j.wrote.vizitlar} vizit, ${j.wrote.vizit_kitoblar} kitob qatori, ${j.wrote.bugungi_reja} reja` }
      : { t: 'err', m: j.error })
  }

  return (
    <main id="main" className="wrap">
      <h1>Google Sheets</h1>
      <p className="sub">Vizitlarni jadvalga yuborish</p>

      {msg && <div className={`alert ${msg.t}`}>{msg.m}</div>}

      {info && !info.configured && (
        // say exactly what is wrong: a missing key and a mistyped URL send you
        // to different places in .env
        <div className="alert err">{info.problem ?? 'Sozlanmagan'}</div>
      )}

      {info?.sheet && (
        <p className="hint" style={{ marginTop: 0 }}>
          Jadval:{' '}
          <a href={info.sheet.url} target="_blank" rel="noopener noreferrer">{info.sheet.url}</a>
        </p>
      )}

      {info?.paused && (
        <div className="alert err">Avtomatik yuborish to&apos;xtatilgan.</div>
      )}
      {info && !info.paused && info.dirty && (
        <div className="alert err">
          Jadval yangilanmagan — oxirgi urinish muvaffaqiyatsiz.
          {info.last_error ? ` (${info.last_error})` : ''} Qayta urinilmoqda.
        </div>
      )}
      {info?.last_ok_at && !info.dirty && (
        <p className="hint" style={{ marginTop: 0 }}>
          Oxirgi yuborilgan: {new Date(info.last_ok_at).toLocaleString('uz')} — har bir vizit
          saqlangach o&apos;zi yuboriladi.
        </p>
      )}

      <div className="tiles" style={{ marginBottom: 20 }}>
        <div className="tile"><b>{info?.visits ?? '—'}</b><span>vizit</span></div>
        <div className="tile"><b>{info?.visit_books ?? '—'}</b><span>kitob qatori</span></div>
      </div>

      <div className="card">
        <p style={{ marginTop: 0 }}>Uchta varaq to&apos;liq qayta yoziladi:</p>
        <ul style={{ color: 'var(--muted)', lineHeight: 1.9, marginTop: 0 }}>
          <li><b>vizitlar</b> — har bir vizit bitta qator</li>
          <li><b>vizit_kitoblar</b> — har bir kitob bitta qator (tahlil uchun)</li>
          <li><b>bugungi_reja</b> — borish vaqti kelgan do&apos;konlar</li>
        </ul>
        <p className="hint">
          Faqat siz ko&apos;ra oladigan ma&apos;lumot yuboriladi — hudud rahbari
          o&apos;z jamoasini, direktor hammasini.
        </p>
        <button className="btn" disabled={busy || !info?.configured} onClick={sync}>
          {busy ? 'Yuborilmoqda…' : 'Jadvalga yuborish'}
        </button>
      </div>
    </main>
  )
}
