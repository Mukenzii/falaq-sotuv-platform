'use client'

import { Fragment, useEffect, useState } from 'react'
import { StoreFilters } from '@/app/StoreFilters'
import { storeMatches } from '@/lib/storeFilter'
import { MML_HOLAT, MML_HOLAT_QISQA, type MmlHolat, type MmlKind } from '@/lib/mml'

type Num = number | string
type Store = {
  store_id: number; code: string; store_name: string; store_category: string | null
  territory: string | null; store_type: string | null
  kerak: Num; bor: Num; yetishmaydi: Num; mml: Num | null; holat: MmlHolat; oxirgi_vizit: string | null
}
type Total = {
  kerak: Num | null; bor: Num | null; mml: Num | null
  hech_borilmagan: Num; borilgan?: Num; talabsiz?: Num; eskirgan?: Num
}
type Book = { book_id: number; title: string; book_category: string; kerak: string; yetishmaydi: string }
type Sync = {
  tabs: { weights: string; books: string }
  columns: string[]
  books: { total: number; matched: number; aliased: string[]; created: string[]; notInSheet: string[] }
  skipped: string[]
  weights: number
  targets: Array<{ column: string; required: number; optional: number }>
}
type Row = {
  book_id: number; title: string; book_category: string | null
  kind: MmlKind; bor: boolean; qolda: boolean
}

const pct = (v: Num | null) => (v === null ? null : Number(v))

/** The same company figure the API computes, over a filtered set of stores. */
function totalOf(rows: Store[]): Total {
  const seen = rows.filter((s) => s.holat === 'olchangan')
  const kerak = seen.reduce((a, s) => a + Number(s.kerak), 0)
  const bor = seen.reduce((a, s) => a + Number(s.bor), 0)
  return {
    kerak: seen.length ? kerak : null,
    bor: seen.length ? bor : null,
    mml: kerak ? Math.round((1000 * bor) / kerak) / 10 : null,
    hech_borilmagan: rows.filter((s) => s.holat === 'olchanmagan').length,
    borilgan: seen.length,
    talabsiz: rows.filter((s) => s.holat === 'majburiy_yoq' || s.holat === 'ustun_yoq').length,
    eskirgan: rows.filter((s) => s.holat === 'qoida_eskirgan').length,
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

// the sheet's "Kat." column, best first; a title with no class goes last
const CLASS_ORDER = ['A++', 'A+', 'A', 'B', 'C', 'NEW']
const classRank = (c: string | null) => {
  const i = CLASS_ORDER.indexOf((c ?? '').trim().toUpperCase())
  return i < 0 ? CLASS_ORDER.length : i
}
const byClass = (a: Row, b: Row) =>
  classRank(a.book_category) - classRank(b.book_category) || a.title.localeCompare(b.title)

/**
 * One store's list: the titles it must carry (1 in the matrix), then the ones
 * it may carry (2), each with its class from the sheet. A row is the "is it on
 * the shelf" switch, and a title on the shelf is gold. A required title that is
 * missing keeps a red ✕; an optional one never does, because it neither counts
 * nor goes missing (db/35).
 */
function Detail({ rows, holat, canEdit, saving, err, onStock }: {
  rows: Row[]; holat: MmlHolat; canEdit: boolean; saving: number | null; err: string
  onStock: (bookId: number, present: boolean) => void
}) {
  const required = rows.filter((r) => r.kind === 'majburiy').sort(byClass)
  const optional = rows.filter((r) => r.kind === 'ixtiyoriy').sort(byClass)
  const found = required.filter((r) => r.bor).length

  const item = (r: Row) => (
    <li key={r.book_id} className={r.bor ? 'bor' : r.kind === 'majburiy' ? 'yoq' : ''}>
      <button type="button" disabled={!canEdit || saving === r.book_id}
        aria-pressed={r.bor}
        onClick={(e) => { e.stopPropagation(); onStock(r.book_id, !r.bor) }}
        title={r.bor ? "Javonda bor — yo'q deb belgilash" : "Javonda yo'q — bor deb belgilash"}>
        <span className="holat" aria-hidden="true">{r.bor ? '✓' : r.kind === 'majburiy' ? '✕' : '·'}</span>
        <span className="name">
          {r.title}
          {r.qolda && <small title="qo'lda belgilangan, vizitdan emas"> ✋</small>}
        </span>
        <span className="cls" title="Kitob klassi (Google Sheets, MML varag'i)">{r.book_category ?? '—'}</span>
        <span className="sr-only">{r.bor ? 'javonda bor' : "javonda yo'q"}</span>
      </button>
    </li>
  )

  return (
    <div className="mmldetail">
      {err && <div className="alert err" style={{ marginBottom: 12 }}>{err}</div>}
      {holat !== 'olchangan' && <p className="hint" style={{ margin: '0 0 10px' }}>{MML_HOLAT[holat]}</p>}
      {canEdit && rows.length > 0 && (
        <p className="hint" style={{ margin: '0 0 10px' }}>
          Kitobni bosing — javonda bor/yo&apos;q holatini o&apos;zgartiradi. Ro&apos;yxatning o&apos;zi
          Google Sheets&apos;dagi MML varag&apos;idan keladi.
        </p>
      )}

      <p className="lbl">Majburiy ({required.length}) — javonda {found} ta</p>
      {required.length === 0
        ? <p className="hint">Majburiy kitob belgilanmagan.</p>
        : <ul className="mmllist">{required.map(item)}</ul>}

      {optional.length > 0 && (
        <>
          <p className="lbl" style={{ marginTop: 14 }}>
            Ixtiyoriy ({optional.length}) <span className="hint">— MML ga ta&apos;sir qilmaydi</span>
          </p>
          <ul className="mmllist">{optional.map(item)}</ul>
        </>
      )}
    </div>
  )
}

export default function MmlClient() {
  const [data, setData] = useState<
    { stores: Store[]; total: Total; books: Book[]; canEdit: boolean
      source: { id: string; url: string; tab: string; booksTab: string } | null } | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [sync, setSync] = useState<Sync | null>(null)
  const [hudud, setHudud] = useState('')
  const [turi, setTuri] = useState('')

  const [loadErr, setLoadErr] = useState('')

  /**
   * A rejected fetch here used to leave the page on "Yuklanmoqda…" forever,
   * because `data` stayed null and nothing ever said why. On a shop's phone,
   * and on a server whose database is down, that is the difference between
   * "the page is broken" and a sentence naming what failed.
   */
  const loadAll = () =>
    fetch('/api/mml')
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `MML yuklanmadi (${r.status})`)
        return r.json()
      })
      .then((j) => { setData(j); setLoadErr('') })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : 'Ulanib bo‘lmadi'))
  useEffect(() => { loadAll() }, [])

  async function loadDetail(id: number) {
    const r = await fetch(`/api/mml?dokon=${id}`)
    const j = r.ok ? await r.json() : { detail: [] }
    setRows(j.detail)
  }

  async function show(id: number) {
    if (open === id) { setOpen(null); return }
    setOpen(id); setRows(null); setErr('')
    await loadDetail(id)
  }

  /**
   * Pull the must-list out of the spreadsheet. The codes are replaced; what
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
   * from here. Re-read the store afterwards so its score comes from the server.
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

  if (!data) {
    return (
      <main id="main" className="wrap-wide">
        {loadErr
          ? <>
              <div className="alert err">{loadErr}</div>
              <button className="btn" onClick={() => { setLoadErr(''); loadAll() }}>Qayta urinish</button>
            </>
          : <p className="sub">Yuklanmoqda…</p>}
      </main>
    )
  }

  const { stores, books } = data
  const filtering = !!(hudud || turi)
  const shown = stores.filter((s) => storeMatches(s, hudud, turi))
  const total = filtering ? totalOf(shown) : data.total
  const company = pct(total?.mml ?? null)
  const measured = stores.filter((s) => s.holat === 'olchangan')
  const stale = stores.filter((s) => s.holat === 'qoida_eskirgan').length

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
                  {t.column}: <b>{t.required}</b> majburiy
                  {t.optional > 0 && <span className="hint"> · {t.optional} ixtiyoriy</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/*
        * How the number is arrived at, on the page that shows the number.
        * Closed by default: it is reference, not something to read every day —
        * but "why is this shop 60%?" was being asked of people instead of the
        * screen, and the answer never changes.
        */}
      <details className="card" style={{ marginBottom: 18 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>MML qanday hisoblanadi?</summary>

        <p style={{ marginBottom: 6 }}><b>1. Do&apos;kon qaysi ustun bilan o&apos;lchanadi</b></p>
        <ul style={{ color: 'var(--muted)', lineHeight: 1.8, marginTop: 0 }}>
          <li><b>Kitob do&apos;kon</b>, toifasi A++, A+ yoki A — <b>Kitob do&apos;kon (A)</b></li>
          <li><b>Kitob do&apos;kon</b>, toifasi B — <b>Kitob do&apos;kon (B)</b></li>
          <li><b>Kitob do&apos;kon</b>, toifasi C yoki belgilanmagan — <b>Kitob do&apos;kon (C)</b></li>
          <li>Boshqa turdagi do&apos;kon (toifasidan qat&apos;i nazar) — o&apos;z turi nomidagi ustun</li>
        </ul>

        <p style={{ marginBottom: 6 }}><b>2. Varaqdagi raqam nimani bildiradi</b></p>
        <ul style={{ color: 'var(--muted)', lineHeight: 1.8, marginTop: 0 }}>
          <li><b>1</b> — <b>majburiy</b>: shu do&apos;konda turishi shart</li>
          <li><b>2</b> — <b>ixtiyoriy</b>: tursa yaxshi, lekin MML ga ta&apos;sir qilmaydi va &laquo;yetishmaydi&raquo; ro&apos;yxatiga tushmaydi</li>
          <li><b>0</b> — talab qilinmaydi (eski varaqlardagi belgi)</li>
        </ul>
        <p className="hint" style={{ marginTop: 0 }}>
          Raqam — talab, kitob soni emas. Boshqa qiymat (masalan eski 0,5) bo&apos;lsa, yangilash to&apos;xtaydi
          va qaysi katak ekanini aytadi — hech narsa o&apos;zgarmaydi.
        </p>

        <p style={{ marginBottom: 6 }}><b>3. Kitob qachon &laquo;bor&raquo; hisoblanadi</b></p>
        <p className="hint" style={{ marginTop: 0 }}>
          Shu yerda <b>qo&apos;lda belgilangan</b> bo&apos;lsa — o&apos;sha. Aks holda —
          <b> oxirgi vizitda</b> javonda ko&apos;rilgan bo&apos;lsa. Undan oldingi vizitlar hisobga olinmaydi,
          va qo&apos;lda belgilash vizitni o&apos;zgartirmaydi.
        </p>

        <p style={{ marginBottom: 6 }}><b>4. Foiz</b></p>
        <pre style={{ background: 'var(--bg2, rgba(0,0,0,.04))', padding: 10, borderRadius: 6,
                      overflowX: 'auto', marginTop: 0, lineHeight: 1.6 }}>
{`kerak = majburiy kitoblar (1)
bor   = ulardan javonda borlari
MML % = 100 × bor / kerak`}
        </pre>
        <p className="hint" style={{ marginTop: 0 }}>
          Ixtiyoriy (2) kitoblar na foizni oshiradi, na tushiradi. Majburiy kitobi yo&apos;q do&apos;konda
          MML <b>yo&apos;q</b> — 100% emas; ro&apos;yxatda shu holat yozilgan holda turadi.
        </p>
        <p className="hint" style={{ marginTop: 6 }}>
          Do&apos;konga hali borilmagan va qo&apos;lda ham hech nima belgilanmagan bo&apos;lsa, MML
          <b> &mdash;</b> bo&apos;lib turadi: bu <b>0% emas</b>, <b>hali o&apos;lchanmagan</b> degani.
        </p>
      </details>

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
        <div className="tile"><b>{total?.hech_borilmagan ?? '—'}</b><span>hali o&apos;lchanmagan</span></div>
      </div>
      {Number(total?.talabsiz ?? 0) > 0 && (
        <p className="hint" style={{ marginTop: -12 }}>
          {total!.talabsiz} ta do&apos;konda majburiy kitob belgilanmagan — ular umumiy foizga kirmaydi,
          ro&apos;yxatda holati bilan turadi.
        </p>
      )}

      {stale > 0 && (
        <div className="alert err">
          {stale} ta do&apos;konning ustunida eski ulush qiymatlari (0,5 / 0,3 / 0,2) qolgan — ularning MML
          ko&apos;rsatilmaydi. {data.canEdit ? "\u201cGoogle Sheets'dan yangilash\u201d ni bosing." : 'Admin varaqni qayta yuklashi kerak.'}
        </div>
      )}
      {measured.length === 0 && stale === 0 && (
        <div className="alert err">
          Hali birorta do&apos;kon o&apos;lchanmagan, shuning uchun MML hisoblanmadi. Menejerlar vizit
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
                      {v === null ? <span className="hint">{MML_HOLAT_QISQA[s.holat]}</span>
                        : <><b>{v}%</b> <Bar value={v} /></>}
                    </td>
                    <td data-label="Oxirgi vizit">{s.oxirgi_vizit ?? <span className="hint">—</span>}</td>
                  </tr>
                  {open === s.store_id && (
                    <tr>
                      <td colSpan={7}>
                        {rows === null ? <span className="hint">Yuklanmoqda…</span> : (
                          <Detail rows={rows} holat={s.holat} canEdit={!!data.canEdit}
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
        Majburiy kitoblar, faqat o&apos;lchangan do&apos;konlar bo&apos;yicha. Bu — yetkazib berish ro&apos;yxati.
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
