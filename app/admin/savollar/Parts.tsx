'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export type Slice = { label: string; value: number }

const fmt = new Intl.NumberFormat('uz-UZ')
const pct = (v: number, total: number) => (total ? Math.round((v / total) * 100) : 0)

/* ---------------- filters ---------------- */

export function Filters({ managers }: { managers: { id: string; full_name: string }[] }) {
  const router = useRouter()
  const params = useSearchParams()

  // state lives in the URL so a filtered view can be sent to someone
  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    value === 'all' ? next.delete(key) : next.set(key, value)
    router.replace(`/admin/savollar?${next.toString()}`)
  }

  return (
    <div className="filters">
      <label>
        <span>Davr</span>
        <select value={params.get('kun') ?? '90'} onChange={(e) => set('kun', e.target.value)}>
          <option value="30">Oxirgi 30 kun</option>
          <option value="90">Oxirgi 90 kun</option>
          <option value="all">Hammasi</option>
        </select>
      </label>
      <label>
        <span>Menejer</span>
        <select value={params.get('manager') ?? 'all'} onChange={(e) => set('manager', e.target.value)}>
          <option value="all">Hamma menejer</option>
          {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </select>
      </label>
    </div>
  )
}

/* ---------------- donut ---------------- */

/**
 * Single-choice questions. Five hues, assigned in fixed order and validated for
 * colour-vision separation; the legend repeats the count so colour is never the
 * only thing carrying the answer.
 */
export function Donut({ slices, total }: { slices: Slice[]; total: number }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!total) return <p className="empty">Javob yo&apos;q</p>

  const R = 62, SW = 26, C = 2 * Math.PI * R
  let acc = 0

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 160 160" className="donut" role="img"
        aria-label={slices.map((s) => `${s.label} ${s.value}`).join(', ')}>
        <g transform="translate(80,80) rotate(-90)">
          {slices.map((s, i) => {
            const len = (s.value / total) * C
            const el = (
              <circle key={s.label} r={R} fill="none" strokeWidth={SW}
                className={`slice s${i} ${hover === i ? 'on' : ''}`}
                strokeDasharray={`${Math.max(len - 2, 0)} ${C - Math.max(len - 2, 0)}`}
                strokeDashoffset={-acc}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            )
            acc += len
            return el
          })}
        </g>
        <text x="80" y="76" textAnchor="middle" className="donut-total">{fmt.format(total)}</text>
        <text x="80" y="94" textAnchor="middle" className="donut-cap">javob</text>
      </svg>

      <ul className="legend">
        {slices.map((s, i) => (
          <li key={s.label}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            className={hover === i ? 'on' : ''}>
            <span className={`key s${i}`} />
            <span className="legend-label">{s.label}</span>
            <span className="legend-value">{fmt.format(s.value)} · {pct(s.value, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------------- bars ---------------- */

export function Bars({
  rows, total, top = 10, unit = '',
}: { rows: Slice[]; total: number; top?: number; unit?: string }) {
  const [all, setAll] = useState(false)
  if (!rows.length) return <p className="empty">Javob yo&apos;q</p>

  const shown = all ? rows : rows.slice(0, top)
  const max = Math.max(...rows.map((r) => r.value), 1)

  return (
    <>
      <ul className="bars">
        {shown.map((r) => (
          <li key={r.label}>
            <span className="bar-label" title={r.label}>{r.label}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            <span className="bar-value">
              {fmt.format(r.value)}{unit && ` ${unit}`}
              {total > 0 && <em> {pct(r.value, total)}%</em>}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > top && (
        <button type="button" className="btn btn-ghost btn-sm showall" onClick={() => setAll(!all)}>
          {all ? 'Qisqartirish' : `Hammasini ko'rsatish (${rows.length})`}
        </button>
      )}
    </>
  )
}

/* ---------------- text answers ---------------- */

export function TextList({ items }: { items: string[] }) {
  const [all, setAll] = useState(false)
  if (!items.length) return <p className="empty">Javob yo&apos;q</p>
  const shown = all ? items : items.slice(0, 6)
  return (
    <>
      <ul className="answers">
        {shown.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
      {items.length > 6 && (
        <button type="button" className="btn btn-ghost btn-sm showall" onClick={() => setAll(!all)}>
          {all ? 'Qisqartirish' : `Hammasini ko'rsatish (${items.length})`}
        </button>
      )}
    </>
  )
}
