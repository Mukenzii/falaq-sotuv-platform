'use client'

import { useEffect, useRef, useState } from 'react'

type Region = { code: string; name: string; dokonlar: number }

export default function RegionPicker({ value, regions, name, onChange }: {
  value: string[]
  regions: Region[]
  name: string
  onChange: (next: string[]) => Promise<boolean> | boolean
}) {
  const [selected, setSelected] = useState(value)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  useEffect(() => setSelected(value), [value])

  async function change(next: string[]) {
    if (saving.current) return
    saving.current = true
    setSelected(next)
    setBusy(true)
    try {
      if (!await onChange(next)) setSelected(value)
    } catch {
      setSelected(value)
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const names = regions.filter((r) => selected.includes(r.code)).map((r) => r.name)
  return (
    <details className="head-region-picker">
      <summary aria-label={`${name}: hududlar — ${names.join(', ') || 'Hudud tanlang'}`}>{names.join(', ') || 'Hudud tanlang'}</summary>
      <fieldset disabled={busy} aria-busy={busy}>
        <legend className="hint">{name} — hududlar</legend>
        {regions.map((r) => (
          <label key={r.code}>
            <input type="checkbox" checked={selected.includes(r.code)}
              onChange={(e) => change(e.target.checked
                ? [...selected, r.code] : selected.filter((code) => code !== r.code))} />
            <span>{r.name} ({r.dokonlar})</span>
          </label>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" disabled={!selected.length}
          onClick={() => change([])}>Barchasini olib tashlash</button>
      </fieldset>
      <span role="status" className="hint">{busy ? 'Saqlanmoqda…' : ''}</span>
    </details>
  )
}
