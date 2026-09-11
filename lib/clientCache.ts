'use client'

import { useEffect, useState } from 'react'

/**
 * Stale-while-revalidate in localStorage, for the handful of lists that barely
 * change: the stores, the books, the published form.
 *
 * Why not rely on the HTTP cache alone: a manager standing in a shop on a bad
 * connection needs the form to open NOW, and a revalidation that takes eight
 * seconds still blocks a max-age=0 request. Reading the last copy synchronously
 * and repainting when the network answers is the difference between a usable
 * tool and a spinner.
 *
 * The cache is wiped on login and on logout, which are the only moments the
 * person behind the browser can change. Nothing here is a security boundary —
 * RLS is — but one manager must never be shown another's territory from disk.
 */
const PREFIX = 'falaq.cache.'

type Entry<T> = { at: number; v: T }

function read<T>(key: string): Entry<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as Entry<T>) : null
  } catch {
    return null // private mode, quota, a half-written entry — all just "no cache"
  }
}

function write<T>(key: string, v: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), v }))
  } catch { /* full or blocked: the app works, it is only slower */ }
}

export function clearClientCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k)
  } catch { /* nothing to clear if we cannot read it */ }
}

type State<T> = { data: T | null; loading: boolean; stale: boolean; error: string | null }

/**
 * `maxAgeMs` only decides whether the cached copy is shown while the network is
 * asked — the request goes out either way, so an edit made on another device
 * still lands on the next open.
 */
export function useCached<T>(key: string, url: string, maxAgeMs = 12 * 60 * 60 * 1000): State<T> {
  const hit = typeof window === 'undefined' ? null : read<T>(key)
  const fresh = !!hit && Date.now() - hit.at < maxAgeMs

  const [state, setState] = useState<State<T>>({
    data: fresh ? (hit as Entry<T>).v : null,
    loading: !fresh,
    stale: fresh,
    error: null,
  })

  useEffect(() => {
    let alive = true
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Yuklanmadi')
        return r.json() as Promise<T>
      })
      .then((v) => {
        if (!alive) return
        write(key, v)
        setState({ data: v, loading: false, stale: false, error: null })
      })
      .catch((e: Error) => {
        if (!alive) return
        // Offline with a copy on disk is not an error — keep showing it.
        setState((s) => s.data
          ? { ...s, loading: false, stale: true, error: null }
          : { data: null, loading: false, stale: false, error: e.message })
      })
    return () => { alive = false }
  }, [key, url])

  return state
}
