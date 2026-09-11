'use client'

import { useEffect, useState } from 'react'
import { freshBlock } from '@/lib/form/doc'
import { TYPE_META, type Block, type FormDoc } from '@/lib/form/types'

/**
 * Two genuinely different sources, kept apart on purpose.
 *
 * "Shu ilovadagi forma" reads a version of this form from the database. It is
 * the only source that is guaranteed to exist, and copying from it can never
 * touch the source: this reads a row and inserts new blocks with new ids.
 *
 * "Google Forms" goes out to the Forms API with the service account. That needs
 * setting up, so the tab says exactly what is missing rather than failing at the
 * moment of import.
 */

type VersionRow = {
  id: number; version: number; status: string; title: string
  questions: string; published_at: string | null; updated_at: string
}

type Source = { title: string; blocks: Block[]; note?: string }

export default function ImportPanel({
  onClose, onInsert,
}: {
  onClose: () => void
  onInsert: (blocks: Block[]) => void
}) {
  const [tab, setTab] = useState<'internal' | 'google'>('internal')
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [google, setGoogle] = useState<{ available: boolean; account: string | null } | null>(null)
  const [url, setUrl] = useState('')
  const [source, setSource] = useState<Source | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/form/versions').then((r) => r.ok ? r.json() : []).then(setVersions).catch(() => {})
    fetch('/api/form/import/google').then((r) => r.ok ? r.json() : null).then(setGoogle).catch(() => {})
  }, [])

  async function loadVersion(v: number) {
    setBusy(true); setErr(''); setSource(null)
    try {
      const r = await fetch(`/api/form?v=${v}`)
      if (!r.ok) throw new Error((await r.json()).error ?? 'Yuklanmadi')
      const body = await r.json()
      const doc: FormDoc = body.doc
      const blocks = doc.sections.flatMap((s) => s.blocks)
      setSource({ title: `${doc.title} — ${v}-versiya`, blocks })
      setPicked(new Set(blocks.filter((b) => b.kind === 'question').map((b) => b.id)))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function loadGoogle() {
    setBusy(true); setErr(''); setSource(null)
    try {
      const r = await fetch('/api/form/import/google', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error ?? 'Import ishlamadi')
      setSource({
        title: body.title,
        blocks: body.blocks,
        note: body.skipped?.length
          ? `O'tkazib yuborildi: ${body.skipped.join(', ')}`
          : undefined,
      })
      setPicked(new Set((body.blocks as Block[]).map((b) => b.id)))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function insert() {
    if (!source) return
    // fresh ids on the way in: a copied id would collide with the original in
    // visit_answers and quietly overwrite its answers
    onInsert(source.blocks.filter((b) => picked.has(b.id)).map(freshBlock))
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Savollarni import qilish">
      <div className="sheet-box">
        <div className="sheet-head">
          <h2>Savollarni import qilish</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Yopish">×</button>
        </div>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'internal'} className={tab === 'internal' ? 'on' : ''}
            onClick={() => { setTab('internal'); setSource(null); setErr('') }}>
            Shu ilovadagi forma
          </button>
          <button role="tab" aria-selected={tab === 'google'} className={tab === 'google' ? 'on' : ''}
            onClick={() => { setTab('google'); setSource(null); setErr('') }}>
            Google Forms
          </button>
        </div>

        <div className="sheet-body">
          {tab === 'internal' ? (
            <>
              <p className="hint">
                Formaning nashr qilingan versiyalaridan savol ko&apos;chiring. Manba
                o&apos;zgarmaydi — savollar yangi id bilan nusxalanadi.
              </p>
              <ul className="srclist">
                {versions.map((v) => (
                  <li key={v.id}>
                    <button type="button" className="btn btn-ghost" disabled={busy}
                      onClick={() => loadVersion(v.version)}>
                      {v.version}-versiya · {v.questions} savol
                      {v.status === 'published' ? ' · joriy' : ''}
                    </button>
                  </li>
                ))}
                {!versions.length && <li className="empty">Boshqa versiya yo&apos;q</li>}
              </ul>
            </>
          ) : (
            <>
              {google && !google.available ? (
                <p className="alert err">
                  Google Forms import sozlanmagan. .env da GOOGLE_SERVICE_ACCOUNT_EMAIL va
                  GOOGLE_PRIVATE_KEY bo&apos;lishi, Cloud loyihada Google Forms API yoqilgan
                  bo&apos;lishi kerak.
                </p>
              ) : (
                <p className="hint">
                  Formani {google?.account ?? 'xizmat akkaunti'} bilan ulashing, so&apos;ng
                  havolasini qo&apos;ying.
                </p>
              )}
              <div className="row">
                <input type="text" value={url} onChange={(e) => setUrl(e.target.value)}
                  aria-label="Google forma havolasi"
                  placeholder="https://docs.google.com/forms/d/…" />
                <button type="button" className="btn" disabled={busy || !url.trim() || !google?.available}
                  onClick={loadGoogle}>{busy ? 'Yuklanmoqda…' : "O'qish"}</button>
              </div>
            </>
          )}

          {err && <p className="alert err">{err}</p>}

          {source && (
            <>
              <h3>{source.title}</h3>
              {source.note && <p className="hint">{source.note}</p>}
              <ul className="picklist">
                {source.blocks.map((b) => (
                  <li key={b.id}>
                    <label className="tick">
                      <input type="checkbox" checked={picked.has(b.id)} onChange={() => toggle(b.id)} />
                      <span>
                        {b.title || <em>nomsiz</em>}
                        <small>
                          {b.kind === 'question'
                            ? `${b.coreKey ? 'asosiy · ' : ''}${TYPE_META[b.type]?.label ?? b.type}`
                            : b.kind}
                        </small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn" disabled={!source || !picked.size} onClick={insert}>
            {picked.size ? `${picked.size} ta savolni qo'shish` : 'Savol tanlang'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Bekor qilish</button>
        </div>
      </div>
    </div>
  )
}
