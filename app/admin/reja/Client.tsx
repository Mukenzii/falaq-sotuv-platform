'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Row = {
  week_start: string; user_id: string; full_name: string
  store_id: number; code: string; store_name: string; store_category: string | null
  bajarildi: boolean; visited_at: string | null; boshqa_vizit: string | null
}
type Summary = { user_id: string; full_name: string; reja: string; bajarildi: string; qoldi: string; foiz: string | null }
type Person = { id: string; full_name: string; role: string }
type Store = { id: number; code: string; name: string; category: string | null }
type Data = { week: string; rows: Row[]; summary: Summary[]; people: Person[]; stores: Store[]; canEdit: boolean }

/** Monday of the week containing d, as YYYY-MM-DD. */
function monday(d: Date): string {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7))
  return x.toISOString().slice(0, 10)
}
const shift = (week: string, days: number) => {
  const d = new Date(week + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const pretty = (week: string) => {
  const a = new Date(week + 'T00:00:00Z')
  const b = new Date(shift(week, 6) + 'T00:00:00Z')
  const f = (d: Date) => `${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  return `${f(a)} — ${f(b)}`
}

export default function RejaClient() {
  const [week, setWeek] = useState(() => monday(new Date()))
  const [data, setData] = useState<Data | null>(null)
  const [who, setWho] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')
  const [onlyFree, setOnlyFree] = useState(true)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (w: string) => {
    const r = await fetch(`/api/plan?hafta=${w}`)
    setData(r.ok ? await r.json() : null)
  }, [])
  useEffect(() => { load(week) }, [week, load])

  const assigned = useMemo(
    () => new Map((data?.rows ?? []).map((r) => [r.store_id, r])), [data])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data?.stores ?? []).filter((s) =>
      (!onlyFree || !assigned.has(s.id)) &&
      (!needle || `${s.code} ${s.name}`.toLowerCase().includes(needle)))
  }, [data, q, onlyFree, assigned])

  async function send(method: 'POST' | 'DELETE', body: unknown, ok: string) {
    setBusy(true); setMsg(null)
    const r = await fetch('/api/plan', {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setMsg({ t: 'err', m: j.error ?? 'Saqlanmadi' }); return }
    setPicked(new Set())
    setMsg({ t: 'ok', m: ok })
    await load(week)
  }

  if (!data) return <main id="main" className="wrap-wide"><p className="sub">Yuklanmoqda…</p></main>

  const byPerson = new Map<string, Row[]>()
  for (const r of data.rows) {
    if (!byPerson.has(r.user_id)) byPerson.set(r.user_id, [])
    byPerson.get(r.user_id)!.push(r)
  }
  const missed = data.rows.filter((r) => !r.bajarildi)
  const thisWeek = monday(new Date())

  return (
    <main id="main" className="wrap-wide">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1>Haftalik reja</h1>
          <p className="sub">
            Har bir xodimga shu haftada borishi kerak bo&apos;lgan do&apos;konlar.
            Vizit shu hafta ichida, o&apos;sha xodim tomonidan qilinsa — bajarilgan hisoblanadi.
          </p>
        </div>
        <div className="row" style={{ flex: '0 0 auto', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeek(shift(week, -7))}>‹</button>
          <b style={{ minWidth: 110, textAlign: 'center' }}>{pretty(week)}</b>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeek(shift(week, 7))}>›</button>
          {week !== thisWeek && (
            <button className="btn btn-ghost btn-sm" onClick={() => setWeek(thisWeek)}>Shu hafta</button>
          )}
        </div>
      </div>

      {msg && <div className={`alert ${msg.t}`} aria-live="polite">{msg.m}</div>}

      <h2>Xodimlar</h2>
      {data.summary.length === 0 ? (
        <div className="card"><p className="hint" style={{ margin: 0 }}>
          Bu haftaga hali reja tuzilmagan.{data.canEdit && ' Pastdan do’kon biriktiring.'}
        </p></div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Xodim</th><th>Reja</th><th>Bajarildi</th><th>Qoldi</th><th>%</th></tr></thead>
            <tbody>
              {data.summary.map((s) => (
                <tr key={s.user_id}>
                  <td data-label="Xodim">{s.full_name}</td>
                  <td data-label="Reja">{s.reja}</td>
                  <td data-label="Bajarildi">{s.bajarildi}</td>
                  <td data-label="Qoldi"><b>{s.qoldi}</b></td>
                  <td data-label="%">{s.foiz === null ? '—' : `${s.foiz}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {missed.length > 0 && (
        <>
          <h2>Borilmagan do&apos;konlar <span className="count">{missed.length}</span></h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Rejada bor, lekin bu hafta o&apos;sha xodim bormagan.
          </p>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Do&apos;kon</th><th>Kim borishi kerak edi</th><th>Izoh</th></tr></thead>
              <tbody>
                {missed.map((r) => (
                  <tr key={r.store_id}>
                    <td data-label="Do'kon">{r.code}<br /><span className="hint">{r.store_name}</span></td>
                    <td data-label="Kim">{r.full_name}</td>
                    <td data-label="Izoh">
                      {/* somebody else covering the shop is not the same as the
                          task being done, but the admin should know */}
                      {r.boshqa_vizit
                        ? <span className="hint">Boshqa xodim {r.boshqa_vizit} da borgan</span>
                        : <span className="hint">Hech kim bormagan</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {[...byPerson.entries()].map(([uid, rows]) => (
        <div key={uid}>
          <h2>{rows[0].full_name} <span className="count">{rows.length}</span></h2>
          <div className="chips">
            {rows.map((r) => (
              <span key={r.store_id} className={`chip on ${r.bajarildi ? 'good' : 'bad'}`}>
                {r.bajarildi ? '✓' : '✕'} {r.code}
                {r.visited_at && <small style={{ opacity: 0.75 }}> · {r.visited_at}</small>}
                {data.canEdit && (
                  <button type="button" className="chipx" disabled={busy}
                    onClick={() => send('DELETE', { hafta: week, store_ids: [r.store_id] }, 'Rejadan olindi')}
                    aria-label={`${r.code} — rejadan olish`} title="Rejadan olish">×</button>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}

      {data.canEdit && (
        <>
          <h2>Do&apos;kon biriktirish</h2>
          <div className="card">
            <div className="row" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
              <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
                <label htmlFor="who">Kimga</label>
                <select id="who" value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="">— tanlang —</option>
                  {data.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
                <label htmlFor="q">Qidirish</label>
                <input id="q" type="text" value={q} onChange={(e) => setQ(e.target.value)}
                       placeholder="kod yoki nomi" />
              </div>
            </div>

            <fieldset style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
              <legend className="lbl">Filtr</legend>
              <div className="chips">
                <button type="button" className={`chip ${onlyFree ? 'on' : ''}`} aria-pressed={onlyFree}
                        onClick={() => setOnlyFree(!onlyFree)}>Faqat rejada yo&apos;qlari</button>
                <button type="button" className="chip"
                        onClick={() => setPicked(new Set(shown.map((s) => s.id)))}>
                  Ko&apos;ringanlarni belgilash ({shown.length})
                </button>
                <button type="button" className="chip" onClick={() => setPicked(new Set())}>Tozalash</button>
              </div>
            </fieldset>

            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
              <table>
                <thead><tr><th /><th>Kod</th><th>Nomi</th><th>Toifa</th><th>Rejada</th></tr></thead>
                <tbody>
                  {shown.map((s) => {
                    const a = assigned.get(s.id)
                    return (
                      <tr key={s.id}>
                        <td data-label="">
                          <input type="checkbox" checked={picked.has(s.id)}
                                 onChange={() => setPicked((p) => {
                                   const n = new Set(p)
                                   if (n.has(s.id)) n.delete(s.id); else n.add(s.id)
                                   return n
                                 })}
                                 aria-label={`${s.code} ${s.name}`} />
                        </td>
                        <td data-label="Kod">{s.code}</td>
                        <td data-label="Nomi">{s.name}</td>
                        <td data-label="Toifa">{s.category ?? <span className="hint">—</span>}</td>
                        <td data-label="Rejada">{a ? a.full_name : <span className="hint">—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" disabled={busy || !who || !picked.size}
                onClick={() => send('POST', { hafta: week, user_id: who, store_ids: [...picked] },
                  `${picked.size} ta do'kon biriktirildi`)}>
                {picked.size ? `${picked.size} ta do'konni biriktirish` : "Do'kon tanlang"}
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
