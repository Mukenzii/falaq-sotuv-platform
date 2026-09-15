'use client'

import { Fragment, useEffect, useState } from 'react'
import { StoreFilters } from '@/app/StoreFilters'
import { storeMatches } from '@/lib/storeFilter'

type Store = {
  store_id: number; code: string; store_name: string; store_category: string | null
  territory: string | null; store_type: string | null
  kerak: string; bor: string; yetishmaydi: string; mml: string | null; oxirgi_vizit: string | null
}
type Total = { kerak: string | null; bor: string | null; mml: string | null; hech_borilmagan: string }
type Book = { book_id: number; title: string; book_category: string; kerak: string; yetishmaydi: string }
type Sync = {
  tab: string
  books: { matched: number; total: number; missing: string[] }
  stores: { matched: number; total: number; missing: string[] }
  rules: number; overrides: number; cells: number
}
type Row = {
  book_id: number; title: string; book_category: string | null
  required: boolean; is_override: boolean; bor: boolean; qolda: boolean
}

const pct = (v: string | null) => (v === null ? null : Number(v))

/** The same company figure the API computes, over a filtered set of stores. */
function totalOf(rows: Store[]): Total {
  const seen = rows.filter((s) => s.oxirgi_vizit)
  const kerak = seen.reduce((a, s) => a + Number(s.kerak), 0)
  const bor = seen.reduce((a, s) => a + Number(s.bor), 0)
  return {
    kerak: seen.length ? String(kerak) : null,
    bor: seen.length ? String(bor) : null,
    mml: kerak ? String(Math.round((1000 * bor) / kerak) / 10) : null,
    hech_borilmagan: String(rows.length - seen.length),
  }
}

/** Red below 70, amber to 90, green above — the same reading as the shelf. */
function Bar({ value }: { value: number }) {
  const tone = value >= 90 ? 'var(--green)' : value >= 70 ? 'var(--amber, #b8721a)' : 'var(--red)'
  return (
    <span className="mmlbar" title={`${value}%`}>
      <span style={{ width: `${Math.min(value, 100)}%`, background: tone }} />
    </span>
  )
}

/**
 * One store's list, in two groups.
 *
 * Colour says what the last visit found; the button says what to do about it.
 * Keeping those separate matters — a red chip is a fact about the shelf, not
 * an invitation to delete the title.
 */
function Detail({ storeId, rows, canEdit, saving, err, onOff, onOn, onReset, onStock }: {
  storeId: number; rows: Row[]; canEdit: boolean; saving: number | null; err: string
  onOff: (bookId: number) => void; onOn: (bookId: number) => void; onReset: (bookId: number) => void
  onStock: (bookId: number, present: boolean) => void
}) {
  const required = rows.filter((r) => r.required)
  const not = rows.filter((r) => !r.required)
  const found = required.filter((r) => r.bor).length

  return (
    <div className="mmldetail">
      {err && <div className="alert err" style={{ marginBottom: 12 }}>{err}</div>}

      <p className="lbl">
        Kerak ({required.length}) — javonda {found} ta
        {canEdit && (
          <span className="hint">
            {' '}· kitobni bosing — bor/yo&apos;q holatini o&apos;zgartiradi · <b>×</b> — ro&apos;yxatdan chiqaradi
          </span>
        )}
      </p>
      <div className="chips">
        {required.length === 0 && <span className="hint">Bu do&apos;kon uchun ro&apos;yxat bo&apos;sh.</span>}
        {required.map((r) => (
          <span key={r.book_id} className={`chip on ${r.bor ? 'good' : 'bad'}`}>
            {/* the label itself is the availability switch; x is a separate one */}
            <button type="button" className="chipmain" disabled={!canEdit || saving === r.book_id}
              aria-pressed={r.bor}
              onClick={(e) => { e.stopPropagation(); onStock(r.book_id, !r.bor) }}
              title={r.bor ? "Javonda bor — yo'q deb belgilash" : "Javonda yo'q — bor deb belgilash"}>
              {r.bor ? '✓' : '✕'} {r.title}
              <small style={{ opacity: 0.75 }}> · {r.book_category ?? '—'}</small>
              {r.qolda && <small title="qo'lda belgilangan, vizitdan emas"> ✋</small>}
              {r.is_override && <small title="ro'yxat qoidadan farq qiladi"> ✎</small>}
            </button>
            {canEdit && (
              <button type="button" className="chipx" disabled={saving === r.book_id}
                onClick={(e) => { e.stopPropagation(); onOff(r.book_id) }}
                aria-label={`${r.title} — ro'yxatdan chiqarish`} title="Ro'yxatdan chiqarish">×</button>
            )}
          </span>
        ))}
      </div>

      <p className="lbl" style={{ marginTop: 14 }}>
        Kerak emas ({not.length})
        {canEdit && <span className="hint"> · ro&apos;yxatga qo&apos;shish uchun bosing</span>}
      </p>
      <div className="chips">
        {not.length === 0 && <span className="hint">Hammasi ro&apos;yxatda.</span>}
        {not.map((r) => (
          <span key={r.book_id} className="chip">
            {r.bor && <span title="javonda bor, lekin ro'yxatda emas">● </span>}
            {r.title}
            <small style={{ opacity: 0.6 }}> · {r.book_category ?? '—'}</small>
            {canEdit && (
              <button type="button" className="chipx" disabled={saving === r.book_id}
                onClick={(e) => { e.stopPropagation(); onOn(r.book_id) }}
                aria-label={`${r.title} — ro'yxatga qo'shish`} title="Ro'yxatga qo'shish">+</button>
            )}
          </span>
        ))}
      </div>

      {canEdit && rows.some((r) => r.is_override) && (
        <p className="hint" style={{ marginTop: 12 }}>
          ✎ — qoidadan farq qiladi.{' '}
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              rows.filter((r) => r.is_override).forEach((r) => onReset(r.book_id))
            }}>
            Qoidaga qaytarish
          </button>
        </p>
      )}
      <span hidden>{storeId}</span>
    </div>
  )
}

export default function MmlClient() {
  const [data, setData] = useState<
    { stores: Store[]; total: Total; books: Book[]; canEdit: boolean
      source: { id: string; url: string; tab: string } | null } | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [sync, setSync] = useState<Sync | null>(null)
  const [hudud, setHudud] = useState('')
  const [turi, setTuri] = useState('')

  const loadAll = () => fetch('/api/mml').then((r) => r.json()).then(setData)
  useEffect(() => { loadAll() }, [])

  async function show(id: number) {
    if (open === id) { setOpen(null); return }
    setOpen(id); setRows(null); setErr('')
    const r = await fetch(`/api/mml?dokon=${id}`)
    setRows(r.ok ? (await r.json()).detail : [])
  }

  /**
   * Pull the must-list back out of the spreadsheet. It replaces the rules and
   * every override, so anything toggled here is discarded — hence the
   * confirm. The sheet is where the commercial team works.
   */
  async function syncFromSheet() {
    if (!confirm(
      "Google Sheets'dagi ro'yxat shu yerdagini butunlay almashtiradi.\n" +
      "Bu yerda qo'lda o'zgartirilgan belgilar yo'qoladi. Davom etamizmi?",
    )) return
    setSyncing(true); setErr(''); setSync(null)
    try {
      const r = await fetch('/api/mml/sync', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) { setErr(j.error ?? 'Yangilanmadi'); return }
      setSync(j)
      setOpen(null); setRows(null)
      await loadAll()
    } catch {
      setErr('Ulanib bo‘lmadi.')
    } finally {
      setSyncing(false)
    }
  }

  /**
   * Put a title in or out of this store's must-list. The row is updated on the
   * spot so the chip reacts immediately, then the store totals are re-read —
   * MML changes the moment the denominator does.
   */
  async function setRequired(store_id: number, book_id: number, required: boolean) {
    setSaving(book_id); setErr('')
    const r = await fetch('/api/mml/override', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ store_id, book_id, required }),
    })
    setSaving(null)
    if (!r.ok) { setErr((await r.json()).error ?? 'Saqlanmadi'); return }
    setRows((rs) => rs?.map((x) => (x.book_id === book_id ? { ...x, required, is_override: true } : x)) ?? rs)
    loadAll()
  }

  /**
   * Say whether a title is on the shelf. This writes store_stock, not the
   * visit: a visit records what a manager saw that day and must not be edited
   * from here. MML moves immediately because the numerator changes.
   */
  async function setStock(store_id: number, book_id: number, present: boolean) {
    setSaving(book_id); setErr('')
    const r = await fetch('/api/mml/stock', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ store_id, book_id, present }),
    })
    setSaving(null)
    if (!r.ok) { setErr((await r.json()).error ?? 'Saqlanmadi'); return }
    setRows((rs) => rs?.map((x) => (x.book_id === book_id ? { ...x, bor: present, qolda: true } : x)) ?? rs)
    loadAll()
  }

  /** Forget the hand-made decision; the rule decides again. */
  async function reset(store_id: number, book_id: number) {
    setSaving(book_id); setErr('')
    const r = await fetch('/api/mml/override', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ store_id, book_id }),
    })
    setSaving(null)
    if (!r.ok) { setErr((await r.json()).error ?? 'Saqlanmadi'); return }
    const fresh = await fetch(`/api/mml?dokon=${store_id}`)
    if (fresh.ok) setRows((await fresh.json()).detail)
    loadAll()
  }

  if (!data) return <main id="main" className="wrap-wide"><p className="sub">Yuklanmoqda…</p></main>

  const { stores, books } = data
  const filtering = !!(hudud || turi)
  const shown = stores.filter((s) => storeMatches(s, hudud, turi))
  const total = filtering ? totalOf(shown) : data.total
  const company = pct(total?.mml ?? null)
  const visited = stores.filter((s) => s.oxirgi_vizit)

  return (
    <main id="main" className="wrap-wide">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1>MML — majburiy assortiment</h1>
          <p className="sub">
            Har bir do&apos;konda turishi kerak bo&apos;lgan kitoblarning nechtasi oxirgi vizitda
            topilgani.
            {data.source && (
              <>
                {' '}Ro&apos;yxat manbai:{' '}
                <a href={data.source.url} target="_blank" rel="noopener noreferrer">
                  <b>{data.source.tab}</b>
                </a>
                {' '}varag&apos;i.
              </>
            )}
          </p>
        </div>
        {data.canEdit && (
          <button className="btn" onClick={syncFromSheet} disabled={syncing}>
            {syncing ? 'Yangilanmoqda…' : "Google Sheets'dan yangilash"}
          </button>
        )}
      </div>

      {sync && (
        <div className="alert ok" style={{ textAlign: 'left' }}>
          <b>{sync.tab}</b> varag&apos;idan olindi: {sync.books.matched}/{sync.books.total} kitob,
          {' '}{sync.stores.matched}/{sync.stores.total} do&apos;kon, {sync.rules} qoida,
          {' '}{sync.overrides} istisno.
          {(sync.books.missing.length > 0 || sync.stores.missing.length > 0) && (
            <>
              <br />
              {/* naming them is the whole value: somebody has to fix the sheet */}
              {sync.books.missing.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <b>Bu kitoblar bazada yo&apos;q</b> (varaqdagi nomi boshqacha yoki kitob
                  qo&apos;shilmagan): {sync.books.missing.join(' · ')}
                </div>
              )}
              {sync.stores.missing.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <b>Bu do&apos;konlar bazada yo&apos;q:</b> {sync.stores.missing.join(' · ')}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {err && <div className="alert err">{err}</div>}

      <div className="tiles" style={{ marginBottom: 22 }}>
        <div className="tile">
          <b>{company === null ? '—' : `${company}%`}</b><span>umumiy MML</span>
        </div>
        <div className="tile"><b>{total?.bor ?? '—'}</b><span>javonda bor</span></div>
        <div className="tile">
          <b>{total?.kerak && total?.bor ? Number(total.kerak) - Number(total.bor) : '—'}</b>
          <span>yetishmaydi</span>
        </div>
        <div className="tile"><b>{total?.hech_borilmagan ?? '—'}</b><span>hali borilmagan</span></div>
      </div>

      {visited.length === 0 && (
        <div className="alert err">
          Hali birorta vizit yo&apos;q, shuning uchun MML hisoblanmadi. Menejerlar vizit
          saqlagach, bu sahifa o&apos;zi to&apos;ladi.
        </div>
      )}

      <h2>Do&apos;konlar</h2>
      <p className="hint" style={{ marginTop: 0 }}>Eng yomoni yuqorida. Qatorni bosing — nimasi yetishmayotgani ko&apos;rinadi.</p>
      <StoreFilters stores={stores} hudud={hudud} turi={turi} idPrefix="mml"
                    onChange={(k, v) => (k === 'hudud' ? setHudud(v) : setTuri(v))}
                    onClear={() => { setHudud(''); setTuri('') }} />
      {filtering && (
        <p className="hint" style={{ marginTop: 0 }}>
          Yuqoridagi umumiy ko&apos;rsatkichlar ham shu filtr bo&apos;yicha: {shown.length} ta do&apos;kon.
        </p>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Do&apos;kon</th><th>Toifa</th><th>Kerak</th><th>Bor</th>
              <th>Yetishmaydi</th><th>MML</th><th>Oxirgi vizit</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const v = pct(s.mml)
              return (
                <Fragment key={s.store_id}>
                  <tr onClick={() => show(s.store_id)} style={{ cursor: 'pointer' }}>
                    <td data-label="Do'kon">{s.code}<br /><span className="hint">{s.store_name}</span></td>
                    <td data-label="Toifa">{s.store_category ?? <span className="hint">toifasiz</span>}</td>
                    <td data-label="Kerak">{s.kerak}</td>
                    <td data-label="Bor">{s.bor}</td>
                    <td data-label="Yetishmaydi"><b>{s.yetishmaydi}</b></td>
                    <td data-label="MML">
                      {v === null ? <span className="hint">borilmagan</span>
                        : <><b>{v}%</b> <Bar value={v} /></>}
                    </td>
                    <td data-label="Oxirgi vizit">{s.oxirgi_vizit ?? <span className="hint">—</span>}</td>
                  </tr>
                  {open === s.store_id && (
                    <tr key={`${s.store_id}-detail`}>
                      <td colSpan={7}>
                        {rows === null ? <span className="hint">Yuklanmoqda…</span> : (
                          <Detail
                            storeId={s.store_id} rows={rows} canEdit={!!data.canEdit}
                            saving={saving} err={err}
                            onOff={(b) => setRequired(s.store_id, b, false)}
                            onOn={(b) => setRequired(s.store_id, b, true)}
                            onReset={(b) => reset(s.store_id, b)}
                            onStock={(b, present) => setStock(s.store_id, b, present)}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <h2>Eng ko&apos;p yetishmaydigan kitoblar</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Faqat borilgan do&apos;konlar hisobga olingan. Bu — yetkazib berish ro&apos;yxati.
        {filtering && ' Filtr bu ro‘yxatga qo‘llanmaydi — barcha do‘konlar bo‘yicha.'}
      </p>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Kitob</th><th>Toifa</th><th>Nechta do&apos;konda kerak</th><th>Nechtasida yo&apos;q</th></tr></thead>
          <tbody>
            {books.length === 0 && (
              <tr><td colSpan={4}><span className="hint">Yetishmayotgan kitob yo&apos;q.</span></td></tr>
            )}
            {books.map((b) => (
              <tr key={b.book_id}>
                <td data-label="Kitob">{b.title}</td>
                <td data-label="Toifa">{b.book_category}</td>
                <td data-label="Nechta do'konda kerak">{b.kerak}</td>
                <td data-label="Nechtasida yo'q"><b>{b.yetishmaydi}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
