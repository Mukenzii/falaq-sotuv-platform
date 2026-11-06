'use client'

import { useEffect, useState } from 'react'
import { MIN_PASSWORD, normalizeUsername, suggestUsername } from '@/lib/password.shared'

type User = {
  id: string
  username: string | null
  full_name: string
  phone: string | null
  role: string
  parent_id: string | null
  parent_name: string | null
  active: boolean
  region_code: string | null
  hudud: string | null
  dokonlar: number
  has_password: boolean
  must_change_password: boolean
}

type Region = { code: string; name: string; dokonlar: number; biriktirilgan: number; xodimlar: string }

/** A password an admin has just set, shown once and never retrievable again. */
type Issued = { full_name: string; username: string; password: string }

const ROLES = ['direktor', 'sotuv_boshligi', 'hudud_rahbari', 'sotuv_manager']
const BLANK = {
  username: '', password: '', full_name: '', phone: '', role: 'sotuv_manager',
  parent_id: '', region_code: '',
}

export default function UsersClient() {
  const [users, setUsers] = useState<User[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [draft, setDraft] = useState(BLANK)
  const [touchedLogin, setTouchedLogin] = useState(false)
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    const [u, g] = await Promise.all([fetch('/api/users'), fetch('/api/regions')])
    setUsers(u.ok ? await u.json() : [])
    setRegions(g.ok ? await g.json() : [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  /**
   * Hand a whole region's shops to one person. Assignment is stores.owner_id
   * and nothing else (db/25), so setting somebody's region on its own changes
   * what they can file exactly not at all — this is the button that does. It
   * is deliberately separate from the region dropdown: picking a region is a
   * note, moving 121 shops off whoever had them is not, and the two should not
   * happen from one click.
   */
  async function assignRegion(u: User) {
    const g = regions.find((r) => r.code === u.region_code)
    if (!g) { setMsg({ t: 'err', m: 'Avval hudud tanlang' }); return }
    const taken = g.xodimlar && g.xodimlar !== u.full_name ? ` Hozir: ${g.xodimlar}.` : ''
    if (!confirm(`${g.name} hududidagi ${g.dokonlar} ta do'kon ${u.full_name}ga biriktirilsinmi?${taken}`)) return
    if (await send('/api/stores', 'PATCH', { hudud: g.code, owner_id: u.id })) {
      setMsg({ t: 'ok', m: `${g.name}: ${g.dokonlar} ta do'kon ${u.full_name}ga biriktirildi` })
    }
  }

  /**
   * Reset somebody's password. The answer carries the new one in the clear
   * because this is the only moment it exists outside a hash — read it to
   * them, and they are made to replace it when they sign in.
   */
  async function resetPassword(u: User) {
    if (!u.username) { setMsg({ t: 'err', m: 'Avval login bering' }); return }
    if (!confirm(`${u.full_name} uchun yangi parol yaratilsinmi? Eskisi ishlamay qoladi.`)) return
    setMsg(null); setIssued(null)
    const r = await fetch(`/api/users/${u.id}/password`, { method: 'POST' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setMsg({ t: 'err', m: j.error ?? 'Xatolik' }); return }
    setIssued({ full_name: j.full_name, username: j.username, password: j.password })
    await load()
  }

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

  // Typing a name fills in a login until the admin types one themselves.
  function setName(full_name: string) {
    setDraft((d) => ({
      ...d, full_name,
      username: touchedLogin ? d.username : suggestUsername(full_name),
    }))
  }

  const canSave = draft.full_name.trim() && draft.username && draft.password.length >= MIN_PASSWORD

  return (
    <main id="main" className="wrap-wide">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1>Xodimlar</h1>
          <p className="sub">{users.length} ta xodim, rahbari bo&apos;yicha tartiblangan</p>
        </div>
        <button className="btn" onClick={() => setOpen(!open)}>{open ? 'Bekor qilish' : 'Xodim qo\'shish'}</button>
      </div>

      {msg && <div className={`alert ${msg.t}`}>{msg.m}</div>}

      {/* Shown once. Reloading the page loses it, which is the point — after
          this moment only the hash exists, and a new one has to be issued. */}
      {issued && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'var(--green)' }}>
          <h2 style={{ marginTop: 0 }}>{issued.full_name} uchun yangi parol</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Shu yerda bir marta ko&apos;rsatiladi. Yozib oling yoki xodimga hozir ayting —
            sahifani yangilasangiz, boshqa ko&apos;rinmaydi.
          </p>
          <div className="row" style={{ gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div className="lbl">Login</div>
              <code style={{ fontSize: 18 }}>{issued.username}</code>
            </div>
            <div>
              <div className="lbl">Parol</div>
              <code style={{ fontSize: 18, letterSpacing: 1 }}>{issued.password}</code>
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
              onClick={() => navigator.clipboard?.writeText(`${issued.username} / ${issued.password}`)
                .then(() => setMsg({ t: 'ok', m: 'Nusxa olindi' }), () => {})}>
              Nusxa olish
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setIssued(null)}>Yopish</button>
          </div>
        </div>
      )}

      {open && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="field row">
            <div><label>Ism familiya</label>
              <input type="text" value={draft.full_name}
                onChange={(e) => setName(e.target.value)} /></div>
            <div><label>Login</label>
              <input type="text" value={draft.username} autoCapitalize="none" spellCheck={false}
                onChange={(e) => { setTouchedLogin(true); setDraft({ ...draft, username: normalizeUsername(e.target.value) }) }} /></div>
            <div><label>Boshlang&apos;ich parol</label>
              {/* Typed, not generated: the admin is usually sitting next to the
                  person. They have to change it on first sign-in anyway. */}
              <input type="text" value={draft.password} autoComplete="off"
                placeholder={`kamida ${MIN_PASSWORD} ta belgi`}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })} /></div>
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
            <div><label>Hudud</label>
              <select value={draft.region_code}
                onChange={(e) => setDraft({ ...draft, region_code: e.target.value })}>
                <option value="">— yo&apos;q —</option>
                {regions.map((g) => (
                  <option key={g.code} value={g.code}>{g.name} ({g.dokonlar})</option>
                ))}
              </select></div>
          </div>
          <button className="btn" disabled={!canSave}
            onClick={async () => {
              const ok = await send('/api/users', 'POST', {
                ...draft,
                parent_id: draft.parent_id || null,
                phone: draft.phone || null,
                region_code: draft.region_code || null,
              })
              if (ok) {
                setIssued({ full_name: draft.full_name.trim(), username: draft.username, password: draft.password })
                setDraft(BLANK); setTouchedLogin(false); setOpen(false)
              }
            }}>Saqlash</button>
          <p className="hint" style={{ marginBottom: 0 }}>
            Xodim shu login va parol bilan kiradi va birinchi kirishda parolni o&apos;zi o&apos;zgartiradi.
          </p>
        </div>
      )}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Ism</th><th>Login</th><th>Lavozim</th><th>Rahbari</th>
              <th>Hudud</th><th>Do&apos;konlar</th><th>Parol</th><th>Holat</th><th />
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
                <td data-label="Login">
                  {/* editable: a login can be wrong, or a person can marry */}
                  <input type="text" defaultValue={u.username ?? ''} style={{ width: 150 }}
                    autoCapitalize="none" spellCheck={false} placeholder="login yo'q"
                    onBlur={(e) => e.target.value !== (u.username ?? '') &&
                      send(`/api/users/${u.id}`, 'PATCH', { username: e.target.value })} />
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
                <td data-label="Hudud">
                  <select value={u.region_code ?? ''}
                    onChange={(e) => send(`/api/users/${u.id}`, 'PATCH',
                      { region_code: e.target.value || null })}>
                    <option value="">—</option>
                    {regions.map((g) => (
                      <option key={g.code} value={g.code}>{g.name} ({g.dokonlar})</option>
                    ))}
                  </select>
                </td>
                <td data-label="Do'konlar">
                  <span style={{ marginRight: 8 }}>{u.dokonlar}</span>
                  <button className="btn btn-ghost btn-sm" disabled={!u.region_code}
                    title="Shu hududdagi barcha do'konlarni shu xodimga biriktirish"
                    onClick={() => assignRegion(u)}>Biriktirish</button>
                </td>
                <td data-label="Parol">
                  {/* "kira olmaydi" is not a warning, it is a fact: an account
                      with no password cannot be signed in to at all. */}
                  {!u.has_password && <span className="tag">kira olmaydi</span>}
                  {u.has_password && u.must_change_password && <span className="tag">vaqtinchalik</span>}
                  <button className="btn btn-ghost btn-sm" disabled={!u.username}
                    title={u.username ? 'Yangi parol yaratish' : 'Avval login bering'}
                    onClick={() => resetPassword(u)}>Parolni tiklash</button>
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
