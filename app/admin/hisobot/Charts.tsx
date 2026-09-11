'use client'

import { useState } from 'react'

export type Point = { label: string; value: number }
export type Row = { label: string; value: number; note?: string }

const fmt = new Intl.NumberFormat('uz-UZ')

/**
 * Weekly visits. One series, so no legend — the heading names it. Hover gives a
 * crosshair and the exact number, because reading a value off a line is guessing.
 */
export function LineChart({ points, unit = '' }: { points: Point[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  if (points.length < 2) return <p className="empty">Grafik uchun ma&apos;lumot yetarli emas</p>

  const W = 640, H = 170, PAD_L = 34, PAD_R = 8, PAD_T = 12, PAD_B = 24
  const max = Math.max(...points.map((p) => p.value), 1)
  const x = (i: number) => PAD_L + (i * (W - PAD_L - PAD_R)) / (points.length - 1)
  const y = (v: number) => PAD_T + (1 - v / max) * (H - PAD_T - PAD_B)

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ')
  const area = `${line} L${x(points.length - 1)},${H - PAD_B} L${x(0)},${H - PAD_B} Z`
  const ticks = [0, Math.round(max / 2), max]

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Haftalik ${unit}: ${points.map((p) => `${p.label} ${p.value}`).join(', ')}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          const i = Math.round(((px - PAD_L) / (W - PAD_L - PAD_R)) * (points.length - 1))
          setHover(Math.max(0, Math.min(points.length - 1, i)))
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD_L - 7} y={y(t) + 4} textAnchor="end" className="tick">{t}</text>
          </g>
        ))}

        <path d={area} className="area" />
        <path d={line} className="line" />

        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={H - PAD_B} className="crosshair" />
            <circle cx={x(hover)} cy={y(points[hover].value)} r={5} className="dot" />
          </>
        )}

        {points.map((p, i) =>
          i % Math.ceil(points.length / 6) === 0 ? (
            <text key={p.label} x={x(i)} y={H - 6} textAnchor="middle" className="tick">{p.label}</text>
          ) : null,
        )}
      </svg>

      <p className="chart-read" aria-live="polite">
        {hover !== null
          ? `${points[hover].label}: ${fmt.format(points[hover].value)} ${unit}`
          : `Eng ko'p: ${fmt.format(max)} ${unit}`}
      </p>
    </div>
  )
}

/**
 * Horizontal bars. Identity comes from the label beside each bar, so every bar is
 * the same colour — nothing here is encoded by hue.
 */
export function BarList({ rows, unit = '' }: { rows: Row[]; unit?: string }) {
  const [hover, setHover] = useState<string | null>(null)
  if (!rows.length) return <p className="empty">Ma&apos;lumot yo&apos;q</p>
  const max = Math.max(...rows.map((r) => r.value), 1)

  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.label}
          onMouseEnter={() => setHover(r.label)}
          onMouseLeave={() => setHover(null)}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="bar-value">
            {fmt.format(r.value)}{unit && ` ${unit}`}
            {r.note && <em>{hover === r.label ? r.note : r.note}</em>}
          </span>
        </li>
      ))}
    </ul>
  )
}
