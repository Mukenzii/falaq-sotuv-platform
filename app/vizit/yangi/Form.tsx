'use client'

import { useEffect, useState } from 'react'
import { useCached } from '@/lib/clientCache'
import Renderer from './Renderer'
import type { FormDoc } from '@/lib/form/types'

/**
 * This is the only place a form document enters the app from the network, so it
 * is the only place that has to distrust one. The renderer walks
 * `doc.sections[].blocks[]` without checking, and a payload of the wrong shape
 * used to reach it and throw a runtime error over the whole page — a manager
 * standing in a shop gets a red screen instead of a form. Checked here, the same
 * situation is the error banner this component already knows how to show.
 */
function isFormDoc(v: unknown): v is FormDoc {
  const d = v as FormDoc | undefined
  return (
    !!d && typeof d === 'object' &&
    Array.isArray(d.sections) &&
    d.sections.every((s) => s && Array.isArray(s.blocks)) &&
    !!d.settings
  )
}

/** Loads the published form and hands it to the shared renderer. */
export default function VisitForm() {
  // The published form is the one thing that must be on screen before anything
  // else can happen, so it is served from the last copy and revalidated.
  const cached = useCached<{ doc: unknown }>('form', '/api/form')

  const [doc, setDoc] = useState<FormDoc | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (cached.error) { setErr(cached.error); return }
    if (!cached.data) return
    if (!isFormDoc(cached.data.doc)) {
      setErr('Forma tushunarsiz keldi — sahifani yangilang')
      return
    }
    setDoc(cached.data.doc)
  }, [cached.data, cached.error])

  return (
    <main id="main" className="wrap">
      <h1>{doc?.title ?? 'Yangi vizit'}</h1>
      {doc?.description && <p className="sub">{doc.description}</p>}
      {err && <div className="alert err">{err}</div>}
      {doc ? <Renderer doc={doc} mode="live" /> : !err && <p className="empty">Yuklanmoqda…</p>}
    </main>
  )
}
