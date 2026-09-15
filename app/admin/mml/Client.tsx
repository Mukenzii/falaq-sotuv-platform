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
  tabs: { weights: string; books: string }
  columns: string[]
  books: { total: number; matched: number; aliased: string[]; created: string[]; notInSheet: string[] }
  skipped: string[]
  weights: number
  targets: Array<{ column: string; named: number; shares: Array<{ category: string; target: number }>; total: number }>
}
type Row = {
  book_id: number; title: string; book_category: string | null
  kind: 'nomma' | 'ulush'; bor: boolean; qolda: boolean
}
type Share = { book_category: string; target: number; bor: string; hisob: string }

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
 * One store's list: the titles it must carry by name, then each category it
 * owes a share of ("any 8 C titles").
 *
 * The chip itself is the "is it on the shelf" switch. A named title that is
 * missing is red; a share title that is missing is not, because no single one
 * of them is required — only enough of them.
 */
function Detail({ rows, shares, canEdit, saving, err, onStock }: {
  rows: Row[]; shares: Share[]; canEdit: boolean; saving: number | null; err: string
  onStock: (bookId: number, present: boolean) => void
}) {
  const named = rows.filter((r) => r.kind === 'nomma')
  const found = named.filter((r) => r.bor).length

  const chip = (r: Row) => (
    <span key={r.book_id} className={`chip ${r.kind === 'nomma' ? `on ${r.bor ? 'good' : 'bad'}` : r.bor ? 'on good' : ''}`}>
      <button type="button" className="chipmain" disabled={!canEdit || saving === r.book_id}
        aria-pressed={r.bor}
        onClick={(e) => { e.stopPropagation(); onStock(r.book_id, !r.bor) }}
        title={r.bor ? "Javonda bor — yo'q deb belgilash" : "Javonda yo'q — bor deb belgilash"}>
        {r.bor ? '✓' : r.kind === 'nomma' ? '✕' : '·'} {r.title}
        {r.qolda && <small title="qo'lda belgilangan, vizitdan emas"> ✋</small>}
      </button>
    </span>
  )

  return (
    <div className="mmldetail">
      {err && <div className="alert err" style={{ marginBottom: 12 }}>{err}</div>}
      {canEdit && (
        <p className="hint" style={{ margin: '0 0 10px' }}>
          Kitobni bosing — javonda bor/yo&apos;q holatini o&apos;zgartiradi. Ro&apos;yxatning o&apos;zi
          Google Sheets&apos;dagi MML varag&apos;idan keladi.
        </p>
      )}

      <p className="lbl">Nomma-nom kerak ({named.length}) — javonda {found} ta</p>
      <div className="chips">
        {named.length === 0 && <span className="hint">Nomma-nom talab qilinadigan kitob yo&apos;q.</span>}
        {named.map(chip)}
      </div>

      {shares.map((sh) => {
        const pool = rows.filter((r) => r.kind === 'ulush' && r.book_category === sh.book_category)
        const bor = Number(sh.bor)
        return (
          <Fragment key={sh.book_category}>
            <p className="lbl" style={{ marginTop: 14 }}>
              {sh.book_category} toifasidan istalgan {sh.target} ta — javonda {bor} ta
              {bor > sh.target && <span className="hint"> · {sh.target} tasi hisoblanadi</span>}
            </p>
            <div className="chips">{pool.map(chip)}</div>
          </Fragment>
        )
      })}
    </div>
  )
}

export default function MmlClient() {
  const [data, setData] = useState<
    { stores: Store[]; total: Total; books: Book[]; canEdit: boolean
      source: { id: string; url: string; tab: string; booksTab: string } | null } | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [shares, setShares] = useState<Share[]>([])
  const [saving, setSaving] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [sync, setSync] = useState<Sync | null>(null)
  const [hudud, setHudud] = useState('')
  const [turi, setTuri] = useState('')

  const loadAll = () => fetch('/api/mml').then((r) => r.json()).then(setData)
  useEffect(() => { loadAll() }, [])

  async function loadDetail(id: number) {
    const r = await fetch(`/api/mml?dokon=${id}`)
    const j = r.ok ? await r.json() : { detail: [], shares: [] }
    setRows(j.detail); setShares(j.shares)
  }

  async function show(id: number) {
    if (open === id) { setOpen(null); return }
    setOpen(id); setRows(null); setShares([]); setErr('')
    await loadDetail(id)
  }

  /**
   * Pull the must-list out of the spreadsheet. The weights are replaced; what
   * someone marked as on the shelf here is kept, since that is a fact about
   * the shop and not part of the list.
   */
  async function syncFromSheet() {
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
   * Say whether a title is on the shelf. This writes store_stock, not the
   * visit: a visit records what a manager saw that day and must not be edited
   * from here. Re-read the store afterwards, because a share caps at its target.
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
    await loadDetail(store_id)
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
            Har bir do&apos;konda turishi kerak bo&apos;lgan kitoblarning qanchasi javonda.
            {data.source && (
              <>
                {' '}Manba:{' '}
                <a href={data.source.url} target="_blank" rel="noopener noreferrer">
                  <b>{data.source.tab}</b> va <b>{data.source.booksTab}</b>
                </a>
                {' '}varaqlari.
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
          <b>{sync.tabs.weights}</b> va <b>{sync.tabs.books}</b> varaqlaridan olindi: {sync.books.total} ta kitob
          ({sync.books.created.length} ta yangi qo&apos;shildi), {sync.columns.length} ta ustun.
          {/* naming them is the useful part: somebody may have to fix the sheet */}
          {sync.books.created.length > 0 && (
            <div style={{ marginTop: 8 }}><b>Yangi qo&apos;shilgan kitoblar:</b> {sync.books.created.join(' · ')}</div>
          )}
          {sync.books.aliased.length > 0 && (
            <div style={{ marginTop: 8 }}><b>Boshqacha yozilgan, mavjud kitobga bog&apos;landi:</b> {sync.books.aliased.join(' · ')}</div>
          )}
          {sync.skipped.length > 0 && (
            <div style={{ marginTop: 8 }}><b>O&apos;tkazib yuborildi:</b> {sync.skipped.join(' · ')}</div>
          )}
          {sync.books.notInSheet.length > 0 && (
            <div style={{ marginTop: 8 }}><b>Varaqda yo&apos;q, hisobdan chiqdi:</b> {sync.books.notInSheet.join(' · ')}</div>
          )}
          <div style={{ marginTop: 10 }}>
            <b>Har bir do&apos;kon turi uchun kerakli kitoblar soni:</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {sync.targets.map((t) => (
                <li key={t.column}>
                  {t.column}: <b>{t.total}</b>
                  {t.shares.length > 0 && (
                    <span className="hint"> ({t.named} nomma-nom + {t.shares.map((s) => `${s.category} ${s.target}`).join(', ')})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {err && !open && <div className="alert err">{err}</div>}

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
              <th>Do&apos;kon</th><th>Ro&apos;yxat</th><th>Kerak</th><th>Bor</th>
              <th>Yetishmaydi</th><th>MML</th><th className="txt">Oxirgi vizit</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const v = pct(s.mml)
              return (
                <Fragment key={s.store_id}>
                  <tr onClick={() => show(s.store_id)} style={{ cursor: 'pointer' }}>
                    <td data-label="Do'kon">{s.code}<br /><span className="hint">{s.store_name}</span></td>
                    <td data-label="Ro'yxat">{s.store_category}</td>
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
                    <tr>
                      <td colSpan={7}>
                        {rows === null ? <span className="hint">Yuklanmoqda…</span> : (
                          <Detail rows={rows} shares={shares} canEdit={!!data.canEdit}
                                  saving={saving} err={err}
                                  onStock={(b, present) => setStock(s.store_id, b, present)} />
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
        Nomma-nom kerak bo&apos;lgan kitoblar, faqat borilgan do&apos;konlar bo&apos;yicha. Bu — yetkazib berish ro&apos;yxati.
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
