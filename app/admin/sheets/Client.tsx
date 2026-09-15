'use client'

import { useEffect, useRef, useState } from 'react'

type Info = {
  configured: boolean
  problem: string | null
  sheet: { id: string; url: string; gid: string | null } | null
  account: string | null
  visits: string; visit_books: string; oxirgi: string | null
  dirty: boolean; last_ok_at: string | null; last_error: string | null; paused: boolean
}

// Google's "The caller does not have permission": the sheet is not shared with
// the app's service account. Only the sheet's owner can fix it.
const denied = (m?: string | null) => !!m && /permission|PERMISSION_DENIED|\b403\b/i.test(m)

function ShareSteps({ account, url }: { account: string | null; url: string | null }) {
  const [copied, setCopied] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  async function copy() {
    if (!account) return
    try {
      await navigator.clipboard.writeText(account)
    } catch {
      // the clipboard API needs https or localhost; a phone on the LAN IP has neither
      field.current?.select()
      document.execCommand('copy')
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="alert err" style={{ textAlign: 'left' }} aria-live="polite">
      <b>Jadvalga yozib bo&apos;lmadi: jadval hali ilovaga ulashilmagan.</b>
      <p style={{ margin: '8px 0' }}>
        Google ilovaning hisobiga bu jadvalni ochishga ruxsat bermayapti. Buni jadval egasi
        bir marta tuzatadi:
      </p>
      <ol style={{ margin: '0 0 0 20px', padding: 0, lineHeight: 1.8 }}>
        <li>
          {url ? <a href={url} target="_blank" rel="noopener noreferrer">Jadvalni oching</a> : 'Jadvalni oching'}
          {' '}va <b>Share</b> (Bulishish) tugmasini bosing.
        </li>
        <li>
          Shu manzilni qo&apos;shing va <b>Editor</b> huquqini tanlang:
          {account && (
            <span className="sharecopy">
              <input ref={field} type="text" readOnly value={account} aria-label="Ilova hisobi manzili"
                     onFocus={(e) => e.target.select()} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                {copied ? 'Nusxalandi' : 'Nusxalash'}
              </button>
            </span>
          )}
        </li>
        <li>
          <b>Send</b> ni bosing. Shundan keyin 30 soniya ichida o&apos;zi yuboriladi — bu yerda
          hech narsa bosish shart emas.
        </li>
      </ol>
    </div>
  )
}

export default function SheetsClient() {
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null)

  const load = () => fetch('/api/sync/sheets').then((r) => r.json()).then(setInfo).catch(() => {})
  useEffect(() => { load() }, [])

  // While a push is owed, keep looking: once the problem is fixed (the sheet
  // shared, Google back) the warning has to go away without a reload.
  useEffect(() => {
    if (!info?.dirty) return
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [info?.dirty])

  // a successful push also retires a permission error left by the button
  useEffect(() => {
    if (info && !info.dirty) setMsg((m) => (m?.t === 'err' && denied(m.m) ? null : m))
  }, [info])

  async function sync() {
    setBusy(true); setMsg(null)
    const r = await fetch('/api/sync/sheets', { method: 'POST' })
    const j = await r.json()
    setBusy(false)
    load()
    setMsg(r.ok
      ? { t: 'ok', m: `Yuborildi — ${j.wrote.vizitlar} ta vizit` }
      : { t: 'err', m: j.error })
  }

  const needsShare = (info?.dirty && denied(info.last_error)) || (msg?.t === 'err' && denied(msg.m))

  return (
    <main id="main" className="wrap">
      <h1>Google Sheets</h1>
      <p className="sub">Vizitlarni jadvalga yuborish</p>

      {needsShare && <ShareSteps account={info?.account ?? null} url={info?.sheet?.url ?? null} />}
      {msg && !(msg.t === 'err' && denied(msg.m)) && <div className={`alert ${msg.t}`}>{msg.m}</div>}

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
      {info && !info.paused && info.dirty && !needsShare && (
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
        <p style={{ marginTop: 0 }}>
          {info?.sheet?.gid ? 'Havoladagi varaq' : <><b>vizitlar</b> varag&apos;i</>} to&apos;liq qayta yoziladi:
        </p>
        <ul style={{ color: 'var(--muted)', lineHeight: 1.9, marginTop: 0 }}>
          <li>har bir vizit — bitta qator, eng yangisi pastda</li>
          <li>formadagi har bir savol — alohida ustun, savolning o&apos;z nomi bilan</li>
          <li>kitoblar, rasm havolalari, GPS va vizit havolasi ham</li>
        </ul>
        <p className="hint">
          Barcha xodimlarning vizitlari yuboriladi. Varaqda boshqa ma&apos;lumot bo&apos;lsa,
          ustiga yozilmaydi — bo&apos;sh varaq havolasini qo&apos;ying.
        </p>
        <button className="btn" disabled={busy || !info?.configured} onClick={sync}>
          {busy ? 'Yuborilmoqda…' : 'Jadvalga yuborish'}
        </button>
      </div>
    </main>
  )
}
