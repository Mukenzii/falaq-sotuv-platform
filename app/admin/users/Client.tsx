'use client'

import { useEffect, useState } from 'react'

type User = {
  id: string
  telegram_id: string
  telegram_username: string | null
  full_name: string
  phone: string | null
  role: string
  parent_id: string | null
  parent_name: string | null
  active: boolean
}

const ROLES = ['direktor', 'sotuv_boshligi', 'hudud_rahbari', 'sotuv_manager']
const BLANK = { telegram_id: '', full_name: '', phone: '', role: 'sotuv_manager', parent_id: '' }

export default function UsersClient() {
  const [users, setUsers] = useState<User[]>([])
  const [draft, setDraft] = useState(BLANK)
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    const r = await fetch('/api/users')
    setUsers(r.ok ? await r.json() : [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function send(url: string, method: string, body?: unknown) {
    setMsg(null)
    const r = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!r.ok) { setMsg({ t: 'err', m: (await r.json()).error ?? 'Xatolik' }); return false }
    await load()
    return true
  }

  return (
    <main id="main" className="wrap-wide">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1>Xodimlar</h1>
          <p className="sub">{users.length} ta xodim, rahbari bo'yicha tartiblangan</p>
        </div>
        <button className="btn" onClick={() => setOpen(!open)}>{open ? 'Bekor qilish' : 'Xodim qo\'shish'}</button>
      </div>

      {msg && <div className={`alert ${msg.t}`}>{msg.m}</div>}

      {open && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="field row">
            <div><label>Telegram ID</label>
              <input value={draft.telegram_id} inputMode="numeric"
                onChange={(e) => setDraft({ ...draft, telegram_id: e.target.value })} /></div>
            <div><label>Ism familiya</label>
              <input type="text" value={draft.full_name}
                onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} /></div>
          </div>
          <div className="field row">
            <div><label>Telefon</label>
              <input type="text" value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></div>
            <div><label>Lavozim</label>
              <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select></div>
            <div><label>Rahbari</label>
              <select value={draft.parent_id} onChange={(e) => setDraft({ ...draft, parent_id: e.target.value })}>
                <option value="">— yo&apos;q —</option>
                {users.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
              </select></div>
          </div>
          <button className="btn" disabled={!draft.telegram_id || !draft.full_name}
            onClick={async () => {
              const ok = await send('/api/users', 'POST', {
                ...draft,
                telegram_id: Number(draft.telegram_id),
                parent_id: draft.parent_id || null,
                phone: draft.phone || null,
              })
              if (ok) { setDraft(BLANK); setOpen(false); setMsg({ t: 'ok', m: 'Xodim qo\'shildi' }) }
            }}>Saqlash</button>
        </div>
      )}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Ism</th><th>Telegram ID</th><th>Lavozim</th><th>Rahbari</th><th>Holat</th><th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'off'}>
                <td data-label="Ism">
                  <input type="text" defaultValue={u.full_name} style={{ minWidth: 150 }}
                    onBlur={(e) => e.target.value !== u.full_name &&
                      send(`/api/users/${u.id}`, 'PATCH', { full_name: e.target.value })} />
                </td>
                <td data-label="Telegram ID">
                  {/* editable: ids change when someone switches Telegram account */}
                  <input type="text" defaultValue={u.telegram_id} style={{ width: 130 }}
                    onBlur={(e) => e.target.value !== u.telegram_id &&
                      send(`/api/users/${u.id}`, 'PATCH', { telegram_id: Number(e.target.value) })} />
                </td>
                <td data-label="Lavozim">
                  <select value={u.role}
                    onChange={(e) => send(`/api/users/${u.id}`, 'PATCH', { role: e.target.value })}>
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td data-label="Rahbari">
                  <select value={u.parent_id ?? ''}
                    onChange={(e) => send(`/api/users/${u.id}`, 'PATCH', { parent_id: e.target.value || null })}>
                    <option value="">—</option>
                    {users.filter((o) => o.id !== u.id)
                      .map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                  </select>
                </td>
                <td data-label="Holat">
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => send(`/api/users/${u.id}`, 'PATCH', { active: !u.active })}>
                    {u.active ? 'Faol' : 'Bloklangan'}
                  </button>
                </td>
                <td data-label="">
                  <button className="btn btn-danger btn-sm"
                    onClick={() => confirm(`${u.full_name} o'chirilsinmi?`) && send(`/api/users/${u.id}`, 'DELETE')}>
                    O&apos;chirish
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !users.length && <div className="empty">Xodim yo&apos;q</div>}
        {loading && <div className="empty">Yuklanmoqda…</div>}
      </div>
    </main>
  )
}
