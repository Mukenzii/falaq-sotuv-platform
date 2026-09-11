'use client'

import { useCallback, useEffect, useState } from 'react'

type Req = { telegram_id: string; username: string | null; display_name: string; created_at: string }
type User = { id: string; telegram_id: string; full_name: string; role: string; parent_id: string | null; active: boolean }

const ROLES = [
  ['direktor', 'Direktor'],
  ['sotuv_boshligi', 'Sotuv boshlig‘i'],
  ['hudud_rahbari', 'Hudud rahbari'],
  ['sotuv_manager', 'Sotuv manager'],
] as const

// The 9000000xx band is the placeholder org chart from db/03_seed.sql. Real
// Telegram ids are nowhere near it, so this is a safe way to point them out.
const isPlaceholder = (tg: string) => Number(tg) >= 900000001 && Number(tg) <= 900000099

export default function SetupClient() {
  const [reqs, setReqs] = useState<Req[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null)

  // per-request approval form, keyed by telegram id
  const [form, setForm] = useState<Record<string, { full_name: string; role: string; parent_id: string }>>({})

  // store assignment

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch('/api/join-requests'), fetch('/api/users'),
    ])
    const rq: Req[] = a.ok ? await a.json() : []
    setReqs(rq)
    setUsers(b.ok ? await b.json() : [])
    setForm((f) => {
      const next = { ...f }
      for (const r of rq) {
        if (!next[r.telegram_id]) {
          next[r.telegram_id] = { full_name: r.display_name, role: 'sotuv_manager', parent_id: '' }
        }
      }
      return next
    })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Someone can press START at any moment; the list should not need a reload.
  useEffect(() => {
    const t = setInterval(() => { fetch('/api/join-requests').then(r => r.ok && r.json()).then(j => j && setReqs(j)) }, 5000)
    return () => clearInterval(t)
  }, [])

  async function send(url: string, method: string, body?: unknown) {
    setMsg(null)
    const r = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setMsg({ t: 'err', m: j.error ?? 'Xatolik' }); return false }
    await load()
    return true
  }

  const placeholders = users.filter((u) => isPlaceholder(u.telegram_id))
  const real = users.filter((u) => !isPlaceholder(u.telegram_id))

  if (loading) return <main id="main" className="wrap-wide"><p className="sub">Yuklanmoqda…</p></main>

  return (
    <main id="main" className="wrap-wide">
      <h1>Sozlash</h1>
      <p className="sub">
        Odamlarni qo‘shish va do‘konlarni taqsimlash. Telegram ID ni qo‘lda yozish shart emas —
        xodim botga <b>START</b> bossa, so‘rovi shu yerda chiqadi.
      </p>

      {msg && <div className={`alert ${msg.t}`} aria-live="polite">{msg.m}</div>}

      {/* 1 — people waiting */}
      <h2>1. Kutilayotgan so‘rovlar {reqs.length > 0 && <span className="count">{reqs.length}</span>}</h2>
      {reqs.length === 0 ? (
        <div className="card">
          <p className="hint" style={{ margin: 0 }}>
            Hozircha so‘rov yo‘q. Xodim <b>@falaqreaderbot</b> ga <b>START</b> bossa, shu yerda paydo bo‘ladi.
          </p>
        </div>
      ) : reqs.map((r) => {
        const f = form[r.telegram_id] ?? { full_name: r.display_name, role: 'sotuv_manager', parent_id: '' }
        const set = (patch: Partial<typeof f>) =>
          setForm((s) => ({ ...s, [r.telegram_id]: { ...f, ...patch } }))
        return (
          <div className="card" key={r.telegram_id} style={{ marginBottom: 12 }}>
            <p className="hint" style={{ marginTop: 0 }}>
              Telegram: <b>{r.display_name}</b>{r.username ? ` (@${r.username})` : ''}
            </p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <div className="field" style={{ marginBottom: 12, minWidth: 180 }}>
                <label htmlFor={`n-${r.telegram_id}`}>Ism familiya</label>
                <input id={`n-${r.telegram_id}`} type="text" value={f.full_name}
                       onChange={(e) => set({ full_name: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: 12, minWidth: 160 }}>
                <label htmlFor={`r-${r.telegram_id}`}>Roli</label>
                <select id={`r-${r.telegram_id}`} value={f.role} onChange={(e) => set({ role: e.target.value })}>
                  {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 12, minWidth: 160 }}>
                <label htmlFor={`p-${r.telegram_id}`}>Rahbari</label>
                <select id={`p-${r.telegram_id}`} value={f.parent_id} onChange={(e) => set({ parent_id: e.target.value })}>
                  <option value="">— yo‘q —</option>
                  {real.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </div>
            </div>
            <div className="row">
              <button className="btn" onClick={() => send(`/api/join-requests/${r.telegram_id}`, 'POST', f)}>
                Tasdiqlash
              </button>
              <button className="btn btn-danger" onClick={() => send(`/api/join-requests/${r.telegram_id}`, 'DELETE')}>
                Rad etish
              </button>
            </div>
          </div>
        )
      })}

      {/* 2 — who exists now */}
      <h2>2. Xodimlar</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Ism</th><th>Roli</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td data-label="Ism">
                  {u.full_name}
                  {isPlaceholder(u.telegram_id) && <span className="tag">namuna</span>}
                  {!u.active && <span className="tag">faolsiz</span>}
                </td>
                <td data-label="Roli">{ROLES.find(([v]) => v === u.role)?.[1] ?? u.role}</td>
                <td data-label="">
                  {isPlaceholder(u.telegram_id) && (
                    <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                      {/* Deleting fails once someone has visits against their
                          name, and the error says to deactivate instead — so
                          that action has to be within reach, not on another page. */}
                      {u.active && (
                        <button className="btn btn-ghost btn-sm"
                                onClick={() => send(`/api/users/${u.id}`, 'PATCH', { active: false })}>
                          Faolsizlantirish
                        </button>
                      )}
                      <button className="btn btn-danger btn-sm"
                              onClick={() => send(`/api/users/${u.id}`, 'DELETE')}>
                        O‘chirish
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {placeholders.length > 0 && (
        <p className="hint">
          <b>{placeholders.length} ta namuna xodim</b> hali turibdi — ular <code>db/03_seed.sql</code> dan
          kelgan, haqiqiy odamlar emas. O‘chirsangiz, do‘konlari egasiz qoladi; pastda qayta taqsimlaysiz.
        </p>
      )}

      {/* Section 3 used to assign stores to owners. Territory was dropped on
          2026-09-11 — shops belong to nobody and the weekly plan says who
          visits what — so the assigner was removed rather than left as a
          control that silently changed nothing. */}
      <h2>3. Haftalik reja</h2>
      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>
          Do&apos;konlar endi hech kimga biriktirilmaydi. Kim qaysi do&apos;konga
          borishini <a href="/admin/reja">Haftalik reja</a> sahifasida belgilaysiz.
        </p>
      </div>

    </main>
  )
}
