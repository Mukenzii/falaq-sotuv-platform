'use client'

import { useState } from 'react'
import type { SelfTestResult, StepState } from '@/lib/selfTest'

const MARK: Record<StepState, { icon: string; color: string }> = {
  ok:   { icon: '✓', color: 'var(--green)' },
  fail: { icon: '✗', color: 'var(--red)' },
  skip: { icon: '–', color: 'var(--grey)' },
}

export default function SelfTestClient({ regions }: { regions: Array<{ code: string; name: string }> }) {
  const [region, setRegion] = useState(regions.find((r) => r.code === '40')?.code ?? regions[0]?.code ?? '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SelfTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true); setResult(null); setError(null)
    try {
      const r = await fetch('/api/selftest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ region }),
      })
      const j = await r.json().catch(() => ({ error: `server ${r.status}` }))
      if (r.ok) setResult(j); else setError(j.error ?? `server ${r.status}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main" className="wrap">
      <h1>Tekshiruv</h1>
      <p className="sub">Test vizit yuborib, u to&apos;g&apos;ri viloyat varag&apos;iga tushishini tekshiradi</p>

      <div className="card">
        <ol style={{ color: 'var(--muted)', lineHeight: 1.8, marginTop: 0, paddingLeft: 20 }}>
          <li>tanlangan viloyatda vaqtinchalik test do&apos;kon ochadi</li>
          <li>xuddi telefondagidek test javoblar bilan vizit yuboradi</li>
          <li>vizit bazaga va Google Sheets&apos;dagi to&apos;g&apos;ri varaqlarga tushganini tekshiradi</li>
          <li>keyin hammasini o&apos;chiradi — bazadan, rasmni va jadvaldagi qatorni ham</li>
        </ol>
        <div className="field">
          <label htmlFor="region">Viloyat</label>
          <select id="region" value={region} disabled={busy} onChange={(e) => setRegion(e.target.value)}>
            {regions.map((r) => <option key={r.code} value={r.code}>{r.code} {r.name}</option>)}
          </select>
        </div>
        <button className="btn" disabled={busy || !region} onClick={run}>
          {busy ? 'Tekshirilmoqda… (1–2 daqiqa)' : 'Testni boshlash'}
        </button>
      </div>

      {error && <div className="alert err" style={{ marginTop: 20 }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 20 }}>
          <div className={`alert ${result.ok ? 'ok' : 'err'}`}>
            {result.ok
              ? `Hammasi ishlayapti — ${result.region.code} ${result.region.name}`
              : `Muammo bor — ${result.region.code} ${result.region.name}`}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 0' }}>
            {result.steps.map((s, i) => (
              <li key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <b style={{ color: MARK[s.state].color, width: 16, flexShrink: 0 }}>{MARK[s.state].icon}</b>
                <div>
                  <div>{s.name}</div>
                  <small style={{ color: 'var(--grey)' }}>{s.detail}</small>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  )
}
