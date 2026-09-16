'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, rectIntersection,
  useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { StoreFilters } from '@/app/StoreFilters'
import { storeMatches } from '@/lib/storeFilter'

type Holat = 'rejada' | 'bugun' | 'kechikmoqda' | 'bajarildi' | 'kechikdi' | 'borilmadi'
type Id = string | number
type Row = {
  week_start: string; visit_date: string; holat: Holat
  user_id: string; full_name: string
  store_id: Id; code: string; store_name: string; store_category: string | null
  bajarildi: boolean; visited_at: string | null; boshqa_vizit: string | null
  // set when a repeating rule placed this task rather than a person
  rule_id: number | null
}
type Rule = {
  id: number; store_id: Id; code: string; store_name: string
  user_id: string; full_name: string; weekday: number
  cadence: string; anchor: string; kelajak: string
}
type Summary = {
  user_id: string; full_name: string; reja: string; bajarildi: string; vaqtida: string
  kechikdi: string; qoldi: string; borilmadi: string; foiz: string | null
}
type Person = { id: string; full_name: string; role: string }
type Store = { id: Id; code: string; name: string; category: string | null; territory: string | null; store_type: string | null }
type Data = {
  week: string; today: string; rows: Row[]; summary: Summary[]
  people: Person[]; stores: Store[]; canEdit: boolean
}
type Msg = { t: 'ok' | 'err'; m: string; where: 'board' | 'assign' }
type Change = { yangi_sana?: string; user_id?: string }

const HOLAT: Record<Holat, { label: string; icon: string }> = {
  rejada:      { label: 'Rejada',             icon: '○' },
  bugun:       { label: 'Bugun',              icon: '●' },
  kechikmoqda: { label: 'Kechikmoqda',        icon: '!' },
  bajarildi:   { label: 'Bajarildi',          icon: '✓' },
  kechikdi:    { label: 'Kechikib bajarildi', icon: '✓' },
  borilmadi:   { label: 'Borilmadi',          icon: '✕' },
}
const DAYS = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba']
// 'bir_marta' is not a cadence, it is the absence of one: the plain assign
// that has always been here. The rest are the cadences in db/23.
const TAKROR: Array<[string, string]> = [
  ['bir_marta',  'Bir marta'],
  ['haftada',    'Har hafta'],
  ['ikki_hafta', 'Ikki haftada bir'],
  ['juft',       'Juft haftalar'],
  ['toq',        'Toq haftalar'],
  ['uch_hafta',  'Uch haftada bir'],
  ['tort_hafta', "To'rt haftada bir"],
  ['oy',         'Oyiga bir'],
]
const TAKROR_LABEL: Record<string, string> = Object.fromEntries(TAKROR)
const SHORT = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya']

/** Monday of the week containing d, as YYYY-MM-DD. */
function monday(d: Date): string {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7))
  return x.toISOString().slice(0, 10)
}
const shift = (day: string, days: number) => {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const ddmm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`
const pretty = (week: string) => `${ddmm(week)} — ${ddmm(shift(week, 6))}`
const dayIndex = (week: string, day: string) =>
  Math.round((+new Date(day + 'T00:00:00Z') - +new Date(week + 'T00:00:00Z')) / 864e5)
// a task is a shop on a day
const keyOf = (store: Id, day: string) => `${store}:${day}`
const rowKey = (r: Row) => keyOf(r.store_id, r.visit_date)

// The pointer decides the column; fall back to overlap for the edges.
const collide: CollisionDetection = (args) => {
  const hit = pointerWithin(args)
  return hit.length ? hit : rectIntersection(args)
}

export default function RejaClient() {
  const [week, setWeek] = useState(() => monday(new Date()))
  const [data, setData] = useState<Data | null>(null)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [busy, setBusy] = useState(false)

  // board
  const [filter, setFilter] = useState('')
  const [boardHudud, setBoardHudud] = useState('')
  const [boardTuri, setBoardTuri] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [dragging, setDragging] = useState<Row | null>(null)
  const justDragged = useRef(false)

  // assigner
  const [who, setWho] = useState('')
  const [days, setDays] = useState<string[]>([])
  const [takror, setTakror] = useState('bir_marta')
  const [rules, setRules] = useState<Rule[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [onlyFree, setOnlyFree] = useState(true)
  const [hudud, setHudud] = useState('')
  const [turi, setTuri] = useState('')

  // Ignore a response that was overtaken by a newer request (fast drags, week steps).
  const seq = useRef(0)
  const load = useCallback(async (w: string) => {
    const n = ++seq.current
    const r = await fetch(`/api/plan?hafta=${w}`)
    const j = r.ok ? await r.json() : null
    if (n === seq.current) setData(j)
  }, [])
  useEffect(() => { load(week) }, [week, load])

  // rules do not belong to a week, so they load once and reload after an edit
  const loadRules = useCallback(async () => {
    const r = await fetch('/api/plan/rules')
    setRules(r.ok ? (await r.json()).rows : [])
  }, [])
  useEffect(() => { loadRules() }, [loadRules])
  // chosen days belong to the week they were chosen in
  useEffect(() => { setDays([]) }, [week])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // a press-and-hold on a phone, so a normal swipe still scrolls the board
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  )

  // every task of a shop this week
  const assigned = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of data?.rows ?? []) {
      const k = String(r.store_id)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    return m
  }, [data])
  const taken = useMemo(() => new Set((data?.rows ?? []).map(rowKey)), [data])
  // a card's territory and type come from the store list; a store that has
  // since gone inactive is not in it and counts as "not set"
  const storeInfo = useMemo(() => new Map((data?.stores ?? []).map((s) => [String(s.id), s])), [data])
  const facetOf = (r: Row) => storeInfo.get(String(r.store_id)) ?? { territory: null, store_type: null }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data?.stores ?? []).filter((s) =>
      (!onlyFree || !assigned.has(String(s.id))) &&
      storeMatches(s, hudud, turi) &&
      (!needle || `${s.code} ${s.name}`.toLowerCase().includes(needle)))
  }, [data, q, onlyFree, assigned, hudud, turi])

  async function call(method: 'POST' | 'PATCH' | 'DELETE', body: unknown, ok: string, where: Msg['where']) {
    setBusy(true); setMsg(null)
    const r = await fetch('/api/plan', {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    setBusy(false)
    if (!r?.ok) {
      setMsg({ t: 'err', m: j.error ?? 'Saqlanmadi', where })
      await load(week)
      return false
    }
    setMsg({ t: 'ok', m: ok, where })
    await load(week)
    return true
  }

  async function callRules(method: 'POST' | 'DELETE', body: unknown, ok: (j: any) => string) {
    setBusy(true); setMsg(null)
    const r = await fetch('/api/plan/rules', {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    setBusy(false)
    if (!r?.ok) {
      setMsg({ t: 'err', m: j.error ?? 'Saqlanmadi', where: 'assign' })
      return false
    }
    setMsg({ t: 'ok', m: ok(j), where: 'assign' })
    await Promise.all([load(week), loadRules()])
    return true
  }

  function move(row: Row, change: Change) {
    const to = change.yangi_sana
    if (to && taken.has(keyOf(row.store_id, to))) {
      setMsg({ t: 'err', m: `${row.code} ${DAYS[dayIndex(week, to)].toLowerCase()} kuni rejada allaqachon bor`, where: 'board' })
      return
    }
    const person = change.user_id ? data?.people.find((p) => p.id === change.user_id) : null
    // optimistic: the card lands where it was dropped; the reload brings the real status
    setData((d) => d && {
      ...d,
      rows: d.rows.map((r) => rowKey(r) === rowKey(row)
        ? { ...r, visit_date: to ?? r.visit_date, user_id: change.user_id ?? r.user_id,
            full_name: person?.full_name ?? r.full_name }
        : r),
    })
    // the open card follows its task to the new day
    if (to && openKey === rowKey(row)) setOpenKey(keyOf(row.store_id, to))
    const what = to
      ? `${row.code} — ${DAYS[dayIndex(week, to)].toLowerCase()}ga ko'chirildi`
      : `${row.code} — ${person?.full_name ?? 'boshqa xodim'}ga berildi`
    return call('PATCH', { store_id: row.store_id, sana: row.visit_date, ...change }, what, 'board')
  }

  function onDragStart(e: DragStartEvent) {
    justDragged.current = true
    setDragging((e.active.data.current as { row: Row }).row)
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    // the click that ends a drag must not open the card
    setTimeout(() => { justDragged.current = false }, 0)
    const row = (e.active.data.current as { row: Row }).row
    const to = e.over?.id ? String(e.over.id) : null
    if (to && to !== row.visit_date) move(row, { yangi_sana: to })
  }

  if (!data) return <main id="main" className="wrap-wide"><p className="sub">Yuklanmoqda…</p></main>

  const thisWeek = monday(new Date())
  const weekDays = Array.from({ length: 7 }, (_, i) => shift(week, i))
  const byWorker = data.rows.filter((r) => !filter || r.user_id === filter)
  const onBoard = byWorker.filter((r) => storeMatches(facetOf(r), boardHudud, boardTuri))
  const missed = data.rows.filter((r) =>
    (r.holat === 'borilmadi' || r.holat === 'kechikmoqda') && storeMatches(facetOf(r), boardHudud, boardTuri))
  const open = openKey ? data.rows.find((r) => rowKey(r) === openKey) ?? null : null
  const alert = (where: Msg['where']) => msg?.where === where &&
    <div className={`alert ${msg.t}`} aria-live="polite">{msg.m}</div>
  const toggleDay = (d: string) =>
    setDays((cur) => cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort())
  const dayNames = (list: string[]) => list.map((d) => SHORT[dayIndex(week, d)]).join(', ')

  return (
    <main id="main" className="wrap-wide">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1>Haftalik reja</h1>
          <p className="sub">
            Kim, qaysi kuni, qaysi do&apos;konga borishi kerak. Rejadagi kuni yoki undan oldin
            borsa — bajarildi, keyinroq shu hafta ichida borsa — kechikib bajarildi.
          </p>
        </div>
        <div className="row" style={{ flex: '0 0 auto', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeek(shift(week, -7))}
                  aria-label="Oldingi hafta">‹</button>
          <b style={{ minWidth: 110, textAlign: 'center' }}>{pretty(week)}</b>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeek(shift(week, 7))}
                  aria-label="Keyingi hafta">›</button>
          {week !== thisWeek && (
            <button className="btn btn-ghost btn-sm" onClick={() => setWeek(thisWeek)}>Shu hafta</button>
          )}
        </div>
      </div>

      <h2>Xodimlar</h2>
      {data.summary.length === 0 ? (
        <div className="card"><p className="hint" style={{ margin: 0 }}>
          Bu haftaga hali reja tuzilmagan.{data.canEdit && ' Pastdan do’kon biriktiring.'}
        </p></div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr>
              <th>Xodim</th><th>Reja</th><th>Vaqtida</th><th>Kechikib</th>
              <th>Qoldi</th><th>Borilmadi</th><th>%</th>
            </tr></thead>
            <tbody>
              {data.summary.map((s) => (
                <tr key={s.user_id}>
                  <td data-label="Xodim">{s.full_name}</td>
                  <td data-label="Reja">{s.reja}</td>
                  <td data-label="Vaqtida">{s.vaqtida}</td>
                  <td data-label="Kechikib">{s.kechikdi}</td>
                  <td data-label="Qoldi"><b>{s.qoldi}</b></td>
                  <td data-label="Borilmadi">{s.borilmadi}</td>
                  <td data-label="%">{s.foiz === null ? '—' : `${s.foiz}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Doska</h2>
      <div className="klegend" aria-label="Holatlar">
        {(Object.keys(HOLAT) as Holat[]).map((h) => (
          <span key={h} className={`kstatus h-${h}`}><i aria-hidden="true">{HOLAT[h].icon}</i>{HOLAT[h].label}</span>
        ))}
      </div>
      {data.summary.length > 1 && (
        <fieldset style={{ marginBottom: 14 }}>
          <legend className="lbl">Xodim</legend>
          <div className="chips">
            <button type="button" className={`chip ${!filter ? 'on' : ''}`} aria-pressed={!filter}
                    onClick={() => setFilter('')}>Hammasi</button>
            {data.summary.map((s) => (
              <button key={s.user_id} type="button" className={`chip ${filter === s.user_id ? 'on' : ''}`}
                      aria-pressed={filter === s.user_id}
                      onClick={() => setFilter(filter === s.user_id ? '' : s.user_id)}>
                {s.full_name}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {data.rows.length > 0 && (
        // counts are cards: one per shop per day, under the worker filter
        <StoreFilters stores={byWorker.map(facetOf)} hudud={boardHudud} turi={boardTuri} idPrefix="doska"
                      onChange={(k, v) => (k === 'hudud' ? setBoardHudud(v) : setBoardTuri(v))}
                      onClear={() => { setBoardHudud(''); setBoardTuri('') }} />
      )}
      {data.canEdit && data.rows.length > 0 && (
        <p className="hint" style={{ margin: '0 0 12px' }}>
          Kartani boshqa kunga suring (telefonda — bosib turib suring). Bosilsa — tafsilotlar.
        </p>
      )}
      {alert('board')}

      <div className="board-wrap">
        <DndContext sensors={sensors} collisionDetection={collide}
                    onDragStart={onDragStart} onDragEnd={onDragEnd}
                    onDragCancel={() => { setDragging(null); justDragged.current = false }}>
          <div className="board">
            {weekDays.map((d, i) => {
              const rows = onBoard.filter((r) => r.visit_date === d)
              return (
                <DayColumn key={d} date={d} index={i} today={data.today} count={rows.length}
                           droppable={data.canEdit}>
                  {rows.map((r) => (
                    <PlanCard key={rowKey(r)} row={r} showWho={!filter}
                              draggable={data.canEdit && !r.bajarildi}
                              onOpen={() => { if (!justDragged.current) setOpenKey(rowKey(r)) }} />
                  ))}
                </DayColumn>
              )
            })}
          </div>
          {/* position: fixed — safe here because no ancestor has a transform */}
          <DragOverlay dropAnimation={null}>
            {dragging && <div className={`kcard lifted h-${dragging.holat}`}><CardBody row={dragging} showWho={!filter} /></div>}
          </DragOverlay>
        </DndContext>
      </div>

      {missed.length > 0 && (
        <>
          <h2>Borilmagan do&apos;konlar <span className="count">{missed.length}</span></h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Rejadagi kuni o&apos;tgan, lekin o&apos;sha xodim hali bormagan.
          </p>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Do&apos;kon</th><th>Kim</th><th>Kun</th><th>Holat</th><th>Izoh</th></tr></thead>
              <tbody>
                {missed.map((r) => (
                  <tr key={rowKey(r)}>
                    <td data-label="Do'kon">{r.code}<br /><span className="hint">{r.store_name}</span></td>
                    <td data-label="Kim">{r.full_name}</td>
                    <td data-label="Kun">{SHORT[dayIndex(week, r.visit_date)]} {ddmm(r.visit_date)}</td>
                    <td data-label="Holat">
                      <span className={`kstatus h-${r.holat}`}><i aria-hidden="true">{HOLAT[r.holat].icon}</i>{HOLAT[r.holat].label}</span>
                    </td>
                    <td data-label="Izoh">
                      {/* somebody else covering the shop is not the same as the
                          task being done, but the admin should know */}
                      {r.boshqa_vizit
                        ? <span className="hint">Boshqa xodim {ddmm(r.boshqa_vizit)} da borgan</span>
                        : <span className="hint">Hech kim bormagan</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data.canEdit && (
        <>
          <h2>Do&apos;kon biriktirish</h2>
          {alert('assign')}
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
                <label htmlFor="takror">Takrorlanish</label>
                <select id="takror" value={takror} onChange={(e) => setTakror(e.target.value)}>
                  {TAKROR.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
                <label htmlFor="q">Qidirish</label>
                <input id="q" type="text" value={q} onChange={(e) => setQ(e.target.value)}
                       placeholder="kod yoki nomi" />
              </div>
            </div>

            <StoreFilters stores={data.stores} hudud={hudud} turi={turi} idPrefix="reja"
                          onChange={(k, v) => (k === 'hudud' ? setHudud(v) : setTuri(v))}
                          onClear={() => { setHudud(''); setTuri('') }} />

            <fieldset style={{ marginBottom: 14 }}>
              <legend className="lbl">Qaysi kunlari</legend>
              <DayPicker week={week} today={data.today} selected={days}
                         onToggle={toggleDay}
                         onUnselect={(d) => setDays((cur) => cur.filter((x) => x !== d))} />
              <p className="hint">Bir nechta kunni tanlash mumkin. Qayta bosilsa — bekor bo&apos;ladi.</p>
            </fieldset>

            <fieldset style={{ marginBottom: 14 }}>
              <legend className="lbl">Filtr</legend>
              <div className="chips">
                <button type="button" className={`chip ${onlyFree ? 'on' : ''}`} aria-pressed={onlyFree}
                        onClick={() => setOnlyFree(!onlyFree)}>Faqat rejada yo&apos;qlari</button>
                <button type="button" className="chip"
                        onClick={() => setPicked(new Set(shown.map((s) => String(s.id))))}>
                  Ko&apos;ringanlarni belgilash ({shown.length})
                </button>
                <button type="button" className="chip" onClick={() => setPicked(new Set())}>Tozalash</button>
              </div>
            </fieldset>

            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
              <table>
                <thead><tr><th /><th>Kod</th><th>Nomi</th><th>Hudud</th><th className="txt">Turi</th><th className="txt">Rejada</th></tr></thead>
                <tbody>
                  {shown.map((s) => {
                    const id = String(s.id)
                    const tasks = assigned.get(id)
                    return (
                      <tr key={id}>
                        <td data-label="">
                          <input type="checkbox" checked={picked.has(id)}
                                 onChange={() => setPicked((p) => {
                                   const n = new Set(p)
                                   if (n.has(id)) n.delete(id); else n.add(id)
                                   return n
                                 })}
                                 aria-label={`${s.code} ${s.name}`} />
                        </td>
                        <td data-label="Kod">{s.code}</td>
                        <td data-label="Nomi">{s.name}</td>
                        <td data-label="Hudud">{s.territory ?? <span className="hint">—</span>}</td>
                        <td data-label="Turi">{s.store_type ?? <span className="hint">—</span>}</td>
                        <td data-label="Rejada">
                          {tasks
                            ? [...new Set(tasks.map((t) => t.full_name))].map((name) =>
                                `${name} · ${dayNames(tasks.filter((t) => t.full_name === name).map((t) => t.visit_date))}`,
                              ).join('; ')
                            : <span className="hint">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" disabled={busy || !who || !days.length || !picked.size}
                onClick={async () => {
                  const storeIds = [...picked].map(Number)
                  // A cadence turns the same choice into a rule: the days picked
                  // above become weekdays, and the board is filled forward.
                  if (takror !== 'bir_marta') {
                    if (await callRules('POST',
                      { sanalar: days, user_id: who, store_ids: storeIds, takror },
                      (j) => `${j.rules} ta qoida saqlandi — ${j.planned} ta reja ${j.weeks} haftaga yozildi`)) {
                      setPicked(new Set())
                    }
                    return
                  }
                  const label = days.length === 1
                    ? `${DAYS[dayIndex(week, days[0])].toLowerCase()}ga`
                    : `${dayNames(days)} kunlariga`
                  if (await call('POST', { sanalar: days, user_id: who, store_ids: storeIds },
                    `${picked.size} ta do'kon — ${label} biriktirildi`, 'assign')) {
                    setPicked(new Set())
                  }
                }}>
                {!picked.size ? "Do'kon tanlang"
                  : !days.length ? 'Kun tanlang'
                  : takror !== 'bir_marta'
                    ? `${picked.size} ta do'kon — ${TAKROR_LABEL[takror].toLowerCase()}`
                    : days.length === 1 ? `${picked.size} ta do'konni biriktirish`
                    : `${picked.size} ta do'konni ${days.length} kunga biriktirish`}
              </button>
            </div>
            {takror !== 'bir_marta' && (
              <p className="hint" style={{ marginTop: 10 }}>
                Tanlangan kunlar hafta kuni sifatida saqlanadi, reja 8 haftaga oldindan yoziladi.
                Rejadan qo&apos;lda olingan yoki boshqa kunga ko&apos;chirilgan kunlar qaytib kelmaydi.
              </p>
            )}
          </div>

          <h2>Takrorlanuvchi rejalar</h2>
          <div className="card">
            {!rules.length ? (
              <p className="hint" style={{ margin: 0 }}>
                Hali qoida yo&apos;q. Yuqorida &quot;Takrorlanish&quot;ni tanlab biriktirsangiz,
                reja keyingi haftalarga o&apos;zi yoziladi.
              </p>
            ) : (
              <>
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Kod</th><th>Xodim</th><th>Kun</th><th>Takrorlanish</th>
                        <th className="num">Oldinda</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((r) => (
                        <tr key={r.id}>
                          <td data-label="Kod">{r.code}</td>
                          <td data-label="Xodim">{r.full_name}</td>
                          <td data-label="Kun">{DAYS[r.weekday]}</td>
                          <td data-label="Takrorlanish">{TAKROR_LABEL[r.cadence] ?? r.cadence}</td>
                          <td className="num" data-label="Oldinda">{r.kelajak}</td>
                          <td>
                            <button type="button" className="btn btn-danger btn-sm" disabled={busy}
                              onClick={() => callRules('DELETE', { id: r.id },
                                (j) => `${r.code} — qoida o'chirildi, ${j.removed} ta kelgusi reja olindi`)}>
                              O&apos;chirish
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row" style={{ marginTop: 14 }}>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                    onClick={() => callRules('POST', { tuldirish: true },
                      (j) => `${j.planned} ta yangi reja yozildi (${j.weeks} hafta)`)}>
                    Keyingi haftalarni to&apos;ldirish
                  </button>
                  <span className="hint" style={{ alignSelf: 'center' }}>
                    Qoida o&apos;chirilsa, o&apos;tgan haftalar tegilmaydi — faqat kelgusi rejalar olinadi.
                  </span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {open && (
        <Details row={open} week={week} today={data.today} people={data.people} canEdit={data.canEdit}
                 busy={busy} taken={taken} onClose={() => setOpenKey(null)}
                 onMove={(change) => move(open, change)}
                 onRemove={async () => {
                   if (await call('DELETE', { sana: open.visit_date, store_ids: [open.store_id] },
                     `${open.code} — ${DAYS[dayIndex(week, open.visit_date)].toLowerCase()} rejadan olindi`, 'board')) {
                     setOpenKey(null)
                   }
                 }} />
      )}
    </main>
  )
}

function DayColumn({ date, index, today, count, droppable, children }: {
  date: string; index: number; today: string; count: number; droppable: boolean; children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date, disabled: !droppable })
  const cls = ['kcol', date === today && 'today', date < today && 'past', isOver && 'over'].filter(Boolean).join(' ')
  return (
    <section ref={setNodeRef} className={cls} aria-labelledby={`kd-${date}`}>
      <header className="khead">
        <span id={`kd-${date}`}><b>{DAYS[index]}</b> <span className="kdate">{ddmm(date)}</span></span>
        {date === today && <span className="ktoday">Bugun</span>}
        <span className="kcount" aria-label={`${count} ta do'kon`}>{count}</span>
      </header>
      <div className="kbody">{count ? children : <p className="kempty">—</p>}</div>
    </section>
  )
}

function CardBody({ row, showWho }: { row: Row; showWho: boolean }) {
  const h = HOLAT[row.holat]
  // codes usually already carry the name ("0101 Anor KTD"); do not print it twice
  const name = row.store_name && !row.code.toLowerCase().includes(row.store_name.toLowerCase())
  return (
    <>
      <span className="kstatus">
        <i aria-hidden="true">{h.icon}</i>{h.label}
        {row.visited_at && <span className="kwhen">· {ddmm(row.visited_at)}</span>}
      </span>
      <span className="kcode">
        {row.code}
        {row.rule_id != null && <i className="krule" title="Takrorlanuvchi reja" aria-hidden="true"> ↻</i>}
      </span>
      {name && <span className="kname">{row.store_name}</span>}
      {showWho && <span className="kwho">{row.full_name}</span>}
    </>
  )
}

function PlanCard({ row, draggable, showWho, onOpen }: {
  row: Row; draggable: boolean; showWho: boolean; onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `plan-${rowKey(row)}`, data: { row }, disabled: !draggable,
  })
  return (
    <button ref={setNodeRef} type="button" {...attributes} {...listeners}
            // it is always clickable, even when it cannot be dragged
            aria-disabled={undefined}
            aria-haspopup="dialog"
            className={`kcard h-${row.holat}${draggable ? ' can-drag' : ''}${isDragging ? ' ghost' : ''}`}
            onClick={onOpen}>
      <CardBody row={row} showWho={showWho} />
    </button>
  )
}

/**
 * Day chips. A click toggles a day; a double click always leaves it
 * unselected (its two clicks toggle twice, so the double click settles it).
 */
function DayPicker({ week, today, selected, onToggle, onUnselect, isDisabled }: {
  week: string; today: string; selected: string[]
  onToggle: (d: string) => void; onUnselect?: (d: string) => void
  isDisabled?: (d: string) => boolean
}) {
  return (
    <div className="chips daychips">
      {Array.from({ length: 7 }, (_, i) => shift(week, i)).map((d, i) => {
        const on = selected.includes(d)
        return (
          <button key={d} type="button" disabled={isDisabled?.(d)}
                  className={`chip ${on ? 'on' : ''}${d === today ? ' istoday' : ''}`}
                  aria-pressed={on} aria-label={`${DAYS[i]} ${ddmm(d)}`}
                  onClick={() => onToggle(d)}
                  onDoubleClick={onUnselect && (() => onUnselect(d))}>
            <b>{SHORT[i]}</b><small>{ddmm(d)}</small>
          </button>
        )
      })}
    </div>
  )
}

function Details({ row, week, today, people, canEdit, busy, taken, onClose, onMove, onRemove }: {
  row: Row; week: string; today: string; people: Person[]; canEdit: boolean; busy: boolean
  taken: Set<string>; onClose: () => void; onMove: (c: Change) => void; onRemove: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // No close() in a cleanup: it fires the close event, which would unset the
  // open card (React's dev double-mount does exactly that). Unmounting removes
  // the dialog anyway.
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  const h = HOLAT[row.holat]
  // a visit already happened: moving the task now would rewrite whether it was done
  const locked = row.bajarildi

  return (
    <dialog ref={ref} className="plansheet" aria-labelledby="sheet-title" onClose={onClose}
            onClick={(e) => { if (e.target === ref.current) onClose() }}>
      <span className={`kstatus h-${row.holat}`}><i aria-hidden="true">{h.icon}</i>{h.label}</span>
      <h3 id="sheet-title">{row.code}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {row.store_name}{row.store_category && ` · ${row.store_category}`}
      </p>

      <dl className="sheetfacts">
        <dt>Rejadagi kun</dt>
        <dd>{DAYS[dayIndex(week, row.visit_date)]}, {ddmm(row.visit_date)}</dd>
        {/* when editable, the select below already names the person */}
        {(!canEdit || locked) && <><dt>Xodim</dt><dd>{row.full_name}</dd></>}
        {row.visited_at && <><dt>Borgan</dt><dd>{ddmm(row.visited_at)}</dd></>}
        {!row.bajarildi && row.boshqa_vizit && (
          <><dt>Izoh</dt><dd>Boshqa xodim {ddmm(row.boshqa_vizit)} da borgan</dd></>
        )}
      </dl>

      {canEdit && (locked ? (
        <p className="hint">Vizit qilingan — kun va xodimni endi o&apos;zgartirib bo&apos;lmaydi.</p>
      ) : (
        <>
          <div className="field" style={{ marginTop: 18, marginBottom: 16 }}>
            <label htmlFor="sheet-who">Xodim</label>
            <select id="sheet-who" value={row.user_id} disabled={busy}
                    onChange={(e) => onMove({ user_id: e.target.value })}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
          <fieldset>
            <legend className="lbl">Boshqa kunga ko&apos;chirish</legend>
            {/* one task = one day, so here a day is a destination, not a toggle;
                days this shop is already planned on are not offered */}
            <DayPicker week={week} today={today} selected={[row.visit_date]}
                       isDisabled={(d) => busy || (d !== row.visit_date && taken.has(keyOf(row.store_id, d)))}
                       onToggle={(d) => { if (d !== row.visit_date) onMove({ yangi_sana: d }) }} />
          </fieldset>
        </>
      ))}

      <div className="sheetacts">
        <a className="btn btn-ghost btn-sm" href={`/dokon/${row.store_id}`}>Do&apos;kon sahifasi</a>
        <span className="spacer" />
        {canEdit && (
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={onRemove}>
            Shu kundan olish
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} autoFocus>Yopish</button>
      </div>
    </dialog>
  )
}
