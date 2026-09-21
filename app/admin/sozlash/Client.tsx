'use client'

import { useCallback, useEffect, useState } from 'react'

type User = {
  id: string; username: string | null; full_name: string; role: string
  active: boolean; has_password: boolean; must_change_password: boolean
}

const ROLES = [
  ['direktor', 'Direktor'],
  ['sotuv_boshligi', 'Sotuv boshlig‘i'],
  ['hudud_rahbari', 'Hudud rahbari'],
  ['sotuv_manager', 'Sotuv manager'],
] as const

/**
 * What used to be here was a queue: somebody pressed START in the bot, their
 * request appeared, an admin approved it. Accounts are now made outright on
 * /admin/users, so there is no queue to show and no waiting to do. This page
 * is what is left — who exists, and whether they can actually get in.
 */
export default function SetupClient() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/users')
    setUsers(r.ok ? await r.json() : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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

  if (loading) return <main id="main" className="wrap-wide"><p className="sub">Yuklanmoqda…</p></main>

  const lockedOut = users.filter((u) => u.active && (!u.username || !u.has_password))

  return (
    <main id="main" className="wrap-wide">
      <h1>Sozlash</h1>
      <p className="sub">
        Kim tizimga kira oladi. Yangi xodim qo&apos;shish va parol berish{' '}
        <a href="/admin/users">Xodimlar</a> sahifasida.
      </p>

      {msg && <div className={`alert ${msg.t}`} aria-live="polite">{msg.m}</div>}

      {lockedOut.length > 0 && (
        <div className="alert err">
          <b>{lockedOut.length} ta faol xodim kira olmaydi</b> — ularda login yoki parol yo&apos;q.
          <a href="/admin/users"> Xodimlar</a> sahifasida to&apos;g&apos;rilang.
        </div>
      )}

      <h2>Xodimlar</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Ism</th><th>Login</th><th>Roli</th><th>Holat</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'off'}>
                <td data-label="Ism">{u.full_name}</td>
                <td data-label="Login">
                  {u.username ? <code>{u.username}</code> : <span className="tag">login yo‘q</span>}
                </td>
                <td data-label="Roli">{ROLES.find(([v]) => v === u.role)?.[1] ?? u.role}</td>
                <td data-label="Holat">
                  {!u.active && <span className="tag">faolsiz</span>}
                  {u.active && !u.has_password && <span className="tag">parol yo‘q</span>}
                  {u.active && u.has_password && u.must_change_password &&
                    <span className="tag">vaqtinchalik parol</span>}
                  {u.active && u.has_password && !u.must_change_password && 'Kira oladi'}
                </td>
                <td data-label="">
                  {/* Deleting fails once somebody has visits against their name,
                      and the error says to deactivate instead — so that action
                      has to be within reach, not on another page. */}
                  {u.active && (
                    <button className="btn btn-ghost btn-sm"
                            onClick={() => send(`/api/users/${u.id}`, 'PATCH', { active: false })}>
                      Faolsizlantirish
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Section 3 used to assign stores to owners. Territory was dropped on
          2026-09-11 — shops belong to nobody and the weekly plan says who
          visits what — so the assigner was removed rather than left as a
          control that silently changed nothing. */}
      <h2>Haftalik reja</h2>
      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>
          Do&apos;konlar hech kimga biriktirilmaydi. Kim qaysi do&apos;konga
          borishini <a href="/admin/reja">Haftalik reja</a> sahifasida belgilaysiz.
        </p>
      </div>
    </main>
  )
}
