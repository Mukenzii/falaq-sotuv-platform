'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { clone } from '@/lib/form/doc'
import type { FormDoc } from '@/lib/form/types'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

export type Loaded = { id: number; version: number; rev: string; updated_at: string; doc: FormDoc }

const DEBOUNCE = 700
const LIMIT = 100

/**
 * Draft state, undo history and autosave.
 *
 * History holds whole documents. A block that was deleted has to come back with
 * its options, its routing and its position intact, and reversing each edit type
 * separately is where that quietly stops being true.
 */
export function useEditor(initial: Loaded) {
  const [doc, setDoc] = useState<FormDoc>(initial.doc)
  const [rev, setRev] = useState(initial.rev)
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [serverDoc, setServerDoc] = useState<FormDoc | null>(null)
  // A 401 is not a save failure you can retry — the session is gone, and
  // "Qayta urinish" will keep failing until the admin logs in again.
  const [expired, setExpired] = useState(false)

  const past = useRef<FormDoc[]>([])
  const future = useRef<FormDoc[]>([])
  const [depth, setDepth] = useState({ past: 0, future: 0 })

  // typing a title is one undo step, not one per keystroke
  const lastKey = useRef<{ key: string; at: number } | null>(null)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<FormDoc | null>(null)
  const inFlight = useRef(false)

  const save = useCallback(async (next: FormDoc) => {
    if (inFlight.current) { pending.current = next; return }
    inFlight.current = true
    setState('saving'); setError(null); setExpired(false)
    try {
      const r = await fetch('/api/form/draft', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ doc: next, rev }),
      })
      const body = await r.json().catch(() => ({}))
      if (r.status === 409) {
        setServerDoc(body.server?.doc ?? null)
        setError(body.error ?? 'Boshqa administrator formani o\'zgartirdi')
        setState('conflict')
        return
      }
      if (r.status === 401) {
        setExpired(true)
        setError('Sessiya tugagan')
        setState('error')
        return
      }
      if (!r.ok) throw new Error(body.error ?? `Saqlanmadi (${r.status})`)
      setRev(String(body.rev))
      setState('saved')
    } catch (e) {
      // the draft stays in memory, so Qayta urinish resends it rather than
      // asking the admin to retype anything
      setError((e as Error).message)
      setState('error')
    } finally {
      inFlight.current = false
      const queued = pending.current
      pending.current = null
      if (queued) save(queued)
    }
  }, [rev])

  const schedule = useCallback((next: FormDoc) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => save(next), DEBOUNCE)
  }, [save])

  /** Every change goes through here: history, then autosave. */
  const apply = useCallback((next: FormDoc | ((d: FormDoc) => FormDoc), coalesceKey?: string) => {
    setDoc((cur) => {
      const value = typeof next === 'function' ? next(cur) : next
      if (value === cur) return cur

      const now = Date.now()
      const merge = coalesceKey
        && lastKey.current?.key === coalesceKey
        && now - lastKey.current.at < 1500
        && past.current.length > 0
      if (!merge) past.current.push(clone(cur))
      if (past.current.length > LIMIT) past.current.shift()
      lastKey.current = coalesceKey ? { key: coalesceKey, at: now } : null
      future.current = []
      setDepth({ past: past.current.length, future: 0 })
      schedule(value)
      return value
    })
  }, [schedule])

  const undo = useCallback(() => {
    setDoc((cur) => {
      const prev = past.current.pop()
      if (!prev) return cur
      future.current.push(clone(cur))
      lastKey.current = null
      setDepth({ past: past.current.length, future: future.current.length })
      schedule(prev)
      return prev
    })
  }, [schedule])

  const redo = useCallback(() => {
    setDoc((cur) => {
      const next = future.current.pop()
      if (!next) return cur
      past.current.push(clone(cur))
      lastKey.current = null
      setDepth({ past: past.current.length, future: future.current.length })
      schedule(next)
      return next
    })
  }, [schedule])

  const retry = useCallback(() => { save(doc) }, [save, doc])

  /** Conflict resolution: take theirs, and start a fresh history from it. */
  const acceptServer = useCallback(async () => {
    const r = await fetch('/api/form?v=draft')
    if (!r.ok) return
    const body = await r.json()
    past.current = []; future.current = []
    setDepth({ past: 0, future: 0 })
    setDoc(body.doc)
    setRev(String(body.rev))
    setState('idle'); setError(null); setServerDoc(null)
  }, [])

  /** Conflict resolution: keep mine, saving over theirs on purpose. */
  const forceMine = useCallback(async () => {
    const r = await fetch('/api/form?v=draft')
    if (!r.ok) return
    const body = await r.json()
    setRev(String(body.rev))
    setServerDoc(null)
    // rev is now current, so the next save is an ordinary one
    setTimeout(() => save(doc), 0)
  }, [doc, save])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Ctrl/Cmd+Z and Shift+Z, but never while the caret is in a text box —
  // the browser's own undo belongs to the field being typed in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      e.shiftKey ? redo() : undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // a half-saved form is worse than a slow tab close
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state === 'saving' || state === 'error' || pending.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [state])

  return {
    doc, setDoc, rev, setRev, apply, undo, redo, retry,
    canUndo: depth.past > 0, canRedo: depth.future > 0,
    state, error, expired, serverDoc, acceptServer, forceMine,
    flush: () => { if (timer.current) clearTimeout(timer.current); return save(doc) },
  }
}
