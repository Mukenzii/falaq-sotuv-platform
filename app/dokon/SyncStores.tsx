'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Report = {
  total: number; inserted: number; updated: number
  retired: string[]; skipped: string[]; noTerritory: string[]; noType: string[]
  tabs: { master: string; graded: string }
}

/** Admin button: rebuild the store list from the "Sotuv uchun" sheet. */
export default function SyncStores() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [err, setErr] = useState<{ m: string; account?: string } | null>(null)

  async function run() {
    setBusy(true); setErr(null); setReport(null)
    const r = await fetch('/api/stores/sync', { method: 'POST' }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    setBusy(false)
    if (!r?.ok) { setErr({ m: j.error ?? 'Yangilanmadi', account: j.account }); return }
    setReport(j)
    router.refresh()
  }

  // fragments, so the alerts wrap onto their own full-width line in the header row
  return (
    <>
      <button className="btn" onClick={run} disabled={busy}>
        {busy ? 'Yangilanmoqda…' : "Google Sheets'dan yangilash"}
      </button>
      {err && (
        <div className="alert err" style={{ flexBasis: '100%', margin: 0 }} aria-live="polite">
          {err.m}
          {err.account && /permission|ruxsat|403/i.test(err.m) && (
            <> — jadvalni <b>{err.account}</b> bilan (Viewer) ulashing.</>
          )}
        </div>
      )}
      {report && (
        <div className="alert ok" style={{ flexBasis: '100%', margin: 0, textAlign: 'left' }} aria-live="polite">
          <b>{report.tabs.master}</b> va <b>{report.tabs.graded}</b> varaqlaridan: {report.total} ta do&apos;kon —
          {' '}{report.inserted} ta yangi, {report.updated} ta yangilandi
          {report.retired.length > 0 && `, ${report.retired.length} ta faolsizlantirildi`}.
          {/* naming them is the useful part: somebody has to fix the sheet */}
          {report.retired.length > 0 && (
            <div style={{ marginTop: 8 }}><b>Varaqda yo&apos;q, faolsizlantirildi:</b> {report.retired.join(' · ')}</div>
          )}
          {report.skipped.length > 0 && (
            <div style={{ marginTop: 8 }}><b>Do&apos;kon emas, o&apos;tkazib yuborildi:</b> {report.skipped.join(' · ')}</div>
          )}
          {report.noTerritory.length > 0 && (
            <div style={{ marginTop: 8 }}><b>Hududi yo&apos;q:</b> {report.noTerritory.join(' · ')}</div>
          )}
          {report.noType.length > 0 && (
            <div style={{ marginTop: 8 }}><b>Turi yo&apos;q:</b> {report.noType.join(' · ')}</div>
          )}
        </div>
      )}
    </>
  )
}
