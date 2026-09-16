'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCached } from '@/lib/clientCache'
import PhotoPicker, { type Photo } from './PhotoPicker'
import { Chip } from './Bits'
import { ContentBlock, QuestionField } from './QuestionFields'
import { coreFilled, tookOrder as tookOrderOf } from '@/lib/form/core'
import { nextSectionIndex, validateAnswer, type Answers, type AnswerValue } from '@/lib/form/answers'
import type { Block, FormDoc, QuestionBlock, Section } from '@/lib/form/types'

/**
 * The one renderer. The managers' form and the editor's preview are the same
 * component with a different `mode`, so a preview cannot flatter a form that
 * would behave differently in the field.
 */

type Store = {
  id: number; code: string; name: string; region: string; kun_otdi?: number
  // only on the ?menga=1 list: the plan's own answer about this shop
  reja_sana?: string | null; eski?: boolean; bajarildi?: boolean
}

// index 0 is Sunday, because that is what getUTCDay() returns
const WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba']

/** Which day the plan wants this shop on, or that it is owed from before. */
function planLabel(s: Store): string {
  if (s.eski) return "o'tgan haftadan"
  if (!s.reja_sana) return ''
  return WEEKDAYS[new Date(s.reja_sana + 'T00:00:00Z').getUTCDay()]
}
type Book = { id: number; title: string }

const PLACEMENT = [
  "Kirish yo'lida / vitrinada", "O'ng tomonda", 'Chap tomonda', "To'g'rida / o'rtada",
  'Kassa yonida', "Do'kon ichkarisida / burchakda", 'Orqa tomonda', "Ko'rinmaydi",
]
const FACING = [
  { v: 'face', l: "Hammasi FACE bilan (muqova ko'rinib turibdi)" },
  { v: 'qisman_face', l: 'Qisman FACE' },
  { v: 'koreshok', l: 'Faqat yon tomoni (koreshok)' },
  { v: 'qutida', l: 'Qutida / ochilmagan holda' },
]
const SHELF = [
  "Ko'z darajasida (135–160 sm)", "Qo'l darajasida (100–135 sm)",
  "Ko'z darajasidan yuqori (160+ sm)", 'Engashish kerak (60–100 sm)', 'Eng pastda (60 sm dan past)',
]
const RESULT = ['Kirdim / Taklif berdim', 'Buyurtma oldim', "Buyurtma yo'q", "Egasi yo'q edi", "Do'kon yopiq edi"]
const NO_ORDER = [
  'Eski zaxira bor / hali sotilmagan', "Puli yo'q / qarzi bor",
  'Narx qimmat deb hisoblaydi', 'Boshqa nashriyot bilan ishlaydi', 'Qiziqmadi',
]
const DEBT = ["Qarz yo'q", 'Qarz bor, muddati kelmagan', "Muddati o'tgan qarz bor", "Bugun to'ladi"]

function BookPicker({ books, chosen, set, tone, disabled }: any) {
  const [q, setQ] = useState('')
  const shown = books.filter((b: Book) => b.title.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="picker">
      <input className="search" aria-label="Kitob qidirish"
        placeholder={`Qidirish… (${chosen.size} tanlandi)`} value={q}
        onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {shown.map((b: Book) => (
          <Chip key={b.id} tone={tone} disabled={disabled} on={chosen.has(b.id)} onClick={() =>
            set((prev: Set<number>) => {
              const n = new Set(prev)
              n.has(b.id) ? n.delete(b.id) : n.add(b.id)
              return n
            })
          }>{b.title}</Chip>
        ))}
      </div>
    </div>
  )
}

export default function Renderer({
  doc, mode, onSubmitted,
}: {
  doc: FormDoc
  mode: 'live' | 'preview'
  onSubmitted?: () => void
}) {
  const preview = mode === 'preview'
  const [stores, setStores] = useState<Store[]>([])
  const [mine, setMine] = useState<Store[]>([])
  // the plan is what the dropdown opens on; the toggle under it opens it up
  const [onlyMine, setOnlyMine] = useState(true)
  const [due, setDue] = useState<Map<number, number>>(new Map())
  const [books, setBooks] = useState<Book[]>([])
  const [f, setF] = useState<any>({ placement: [], shelf_heights: [], visit_result: [] })
  const [answers, setAnswers] = useState<Answers>({})
  const [present, setPresent] = useState<Set<number>>(new Set())
  const [stale, setStale] = useState<Set<number>>(new Set())
  const [photos, setPhotos] = useState<Photo[]>([])
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [si, setSi] = useState(0)
  const [trail, setTrail] = useState<number[]>([])
  const top = useRef<HTMLDivElement>(null)

  const paged = doc.settings.pagination === 'sections' && doc.sections.length > 1

  // Cached: on shop wifi the last known list beats an empty dropdown, and the
  // network answer replaces it as soon as it lands.
  const cachedStores = useCached<Store[]>('stores', '/api/stores')
  const cachedDue = useCached<Store[]>('stores-reja', '/api/stores?reja=1')
  const cachedMine = useCached<Store[]>('stores-menga', '/api/stores?menga=1')
  const cachedBooks = useCached<Book[]>('books', '/api/books')

  useEffect(() => { if (cachedStores.data) setStores(cachedStores.data) }, [cachedStores.data])
  useEffect(() => { if (cachedMine.data) setMine(cachedMine.data) }, [cachedMine.data])
  useEffect(() => { if (cachedBooks.data) setBooks(cachedBooks.data) }, [cachedBooks.data])
  useEffect(() => {
    if (cachedDue.data) setDue(new Map(cachedDue.data.map((s) => [s.id, s.kun_otdi ?? 0])))
  }, [cachedDue.data])

  useEffect(() => {
    if (!preview) {
      navigator.geolocation?.getCurrentPosition(
        (p) => setF((x: any) => ({ ...x, lat: p.coords.latitude, lng: p.coords.longitude })),
        () => {}, { timeout: 8000 },
      )
    }
  }, [preview])

  // a shorter or reordered form must not leave the reader on a page that is gone
  useEffect(() => { if (si >= doc.sections.length) { setSi(0); setTrail([]) } }, [doc.sections.length, si])

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }

  const tookOrder = f.visit_result.includes('Buyurtma oldim')
  const sorted = useMemo(
    () => [...stores].sort((a, b) => (due.get(b.id) ?? -1) - (due.get(a.id) ?? -1)),
    [stores, due],
  )
  const chosenStore = stores.find((s) => String(s.id) === String(f.store_id))

  /** Exactly the body POST /api/visits will receive — so the client checks the same thing. */
  const body = () => ({
    ...f,
    store_id: f.store_id ? Number(f.store_id) : null,
    width_m: num(f.width_m),
    height_m: num(f.height_m),
    cash_collected: num(f.cash_collected),
    no_order_reason: tookOrder ? null : f.no_order_reason ?? null,
    photos: photos.map(({ object_key, content_type, bytes }) => ({ object_key, content_type, bytes })),
    present_book_ids: [...present],
    stale_book_ids: [...stale],
    answers,
  })

  const sections = doc.sections
  const shown: Section[] = paged ? [sections[si]].filter(Boolean) : sections

  /** Which questions are on screen right now — the only ones worth complaining about. */
  function questionsOf(list: Section[]): QuestionBlock[] {
    return list.flatMap((s) => s.blocks.filter(
      (b): b is QuestionBlock => b.kind === 'question' && !b.hidden
        && !(b.coreKey === 'no_order_reason' && tookOrder)))
  }

  function checkAll(list: Section[]): Record<string, string> {
    const out: Record<string, string> = {}
    const payload = body()
    for (const q of questionsOf(list)) {
      if (q.coreKey) {
        if (q.required && !coreFilled(q, payload)) out[q.id] = 'Bu savol majburiy'
        if (q.coreKey === 'cash_collected' && (num(f.cash_collected) ?? 0) < 0) {
          out[q.id] = "Manfiy bo'lishi mumkin emas"
        }
        continue
      }
      const err = validateAnswer(q, answers[q.id] ?? null)
      if (err) out[q.id] = err
    }
    return out
  }

  const liveErrors = checkAll(shown)
  const missingLabels = questionsOf(shown)
    .filter((q) => liveErrors[q.id])
    .map((q) => q.title)

  const setAnswer = (id: string, v: AnswerValue) => setAnswers((a) => ({ ...a, [id]: v }))
  // Every core setter uses the updater form. Two chips tapped in the same tick
  // both read the same stale `f` otherwise, and the second silently discards
  // the first — which is invisible until someone taps quickly in a shop.
  const toggleStr = (key: string, v: string) =>
    setF((x: any) => ({
      ...x,
      [key]: x[key].includes(v) ? x[key].filter((i: string) => i !== v) : [...x[key], v],
    }))

  function scrollTop() {
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function goNext() {
    const errs = checkAll([sections[si]])
    setErrors(errs)
    if (Object.keys(errs).length) { setMsg({ t: 'err', m: 'Avval majburiy savollarga javob bering' }); return }
    setMsg(null)
    const j = nextSectionIndex(doc, si, answers)
    if (j === null) { submit(); return }
    setTrail((t) => [...t, si])
    setSi(j)
    scrollTop()
  }

  function goBack() {
    setTrail((t) => {
      const prev = t[t.length - 1]
      if (prev === undefined) return t
      setSi(prev)
      return t.slice(0, -1)
    })
    setErrors({})
    scrollTop()
  }

  const lastPage = paged && nextSectionIndex(doc, si, answers) === null

  async function submit() {
    if (preview) {
      setMsg({ t: 'ok', m: "Ko'rish rejimi — javob saqlanmadi" })
      return
    }
    const errs = checkAll(paged ? [sections[si]] : sections)
    setErrors(errs)
    if (Object.keys(errs).length) { setMsg({ t: 'err', m: 'Avval majburiy savollarga javob bering' }); return }

    setBusy(true); setMsg(null)
    const r = await fetch('/api/visits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body()),
    })
    setBusy(false)
    if (r.ok) {
      setMsg({ t: 'ok', m: doc.settings.confirmText || 'Vizit saqlandi' })
      setF({ placement: [], shelf_heights: [], visit_result: [] })
      setPresent(new Set()); setStale(new Set()); setPhotos([]); setAnswers({})
      setSi(0); setTrail([]); setErrors({})
      window.scrollTo({ top: 0, behavior: 'smooth' })
      onSubmitted?.()
    } else {
      setMsg({ t: 'err', m: (await r.json()).error ?? 'Xatolik yuz berdi' })
    }
  }

  /* ---------- core questions keep their bespoke widgets ---------- */

  function renderCore(b: QuestionBlock) {
    const err = errors[b.id]
    const star = b.required ? <span className="req" aria-hidden="true"> *</span> : null
    const wrap = (inner: React.ReactNode, group = false) => {
      const Tag: any = group ? 'fieldset' : 'div'
      return (
        <Tag className={`field ${err ? 'has-err' : ''}`} key={b.id}>
          {inner}
          {b.description && <p className="hint">{b.description}</p>}
          {err && <p className="fielderr">{err}</p>}
        </Tag>
      )
    }

    switch (b.coreKey) {
      case 'store_id': {
        // The plan decides what this opens on. It does not decide what may be
        // filed: a manager standing in a shop nobody planned still has to be
        // able to log the visit, and the database has allowed any shop since
        // db/16. So the plan is the default, not a gate.
        const usingMine = onlyMine && mine.length > 0
        const list = usingMine ? mine : sorted
        return wrap(
          <>
            <label htmlFor="store">{b.title}{star}</label>
            <select id="store" disabled={preview} value={f.store_id ?? ''}
              onChange={(e) => setF((x: any) => ({ ...x, store_id: e.target.value }))}>
              <option value="">— tanlang —</option>
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {usingMine
                    ? `${s.bajarildi ? '✓ ' : ''}${s.code}${planLabel(s) ? ` — ${planLabel(s)}` : ''}`
                    : `${due.has(s.id) ? '● ' : ''}${s.code}`}
                </option>
              ))}
            </select>
            {mine.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
                disabled={preview} onClick={() => setOnlyMine((v) => !v)}>
                {usingMine
                  ? `Hamma do'konlar (${stores.length})`
                  : `Menga biriktirilganlar (${mine.length})`}
              </button>
            )}
            <p className="hint">
              {usingMine
                ? "Shu hafta sizga biriktirilgan do'konlar · ✓ borilgan"
                : mine.length === 0
                  ? "Sizga do'kon biriktirilmagan — hamma do'konlar ko'rsatilyapti"
                  : chosenStore
                    ? due.has(chosenStore.id)
                      ? `● ${due.get(chosenStore.id) === 999 ? 'hali borilmagan' : due.get(chosenStore.id) + ' kun oldin borilgan'}`
                      : 'yaqinda borilgan'
                    : "● belgisi — borish vaqti kelgan do'konlar"}
            </p>
          </>,
        )
      }
      case 'width_m': case 'height_m': case 'open_from': case 'open_to': {
        const isNum = b.coreKey === 'width_m' || b.coreKey === 'height_m'
        return wrap(
          <>
            <label htmlFor={b.coreKey}>{b.title}{star}</label>
            <input id={b.coreKey} disabled={preview} type={isNum ? 'number' : 'time'}
              {...(isNum ? { min: '0', step: '0.5', inputMode: 'decimal' as const } : {})}
              value={f[b.coreKey!] ?? ''}
              onChange={(e) => setF((x: any) => ({ ...x, [b.coreKey!]: e.target.value }))} />
          </>,
        )
      }
      case 'placement': case 'shelf_heights': {
        const list = b.coreKey === 'placement' ? PLACEMENT : SHELF
        return wrap(
          <>
            <legend className="lbl">{b.title}{star}</legend>
            <div className="chips">
              {list.map((p) => (
                <Chip key={p} disabled={preview} on={f[b.coreKey!].includes(p)}
                  onClick={() => toggleStr(b.coreKey!, p)}>{p}</Chip>
              ))}
            </div>
          </>, true,
        )
      }
      case 'facing':
        return wrap(
          <>
            <legend className="lbl">{b.title}{star}</legend>
            <div className="chips">
              {FACING.map((o) => (
                <Chip key={o.v} disabled={preview} on={f.facing === o.v}
                  onClick={() => setF((x: any) => ({ ...x, facing: o.v }))}>{o.l}</Chip>
              ))}
            </div>
          </>, true,
        )
      case 'photos':
        return wrap(
          <>
            <span className="lbl">{b.title}{star}</span>
            <PhotoPicker photos={photos} onChange={setPhotos} />
          </>,
        )
      case 'present_books': case 'stale_books': {
        const isPresent = b.coreKey === 'present_books'
        return wrap(
          <>
            <legend className="lbl">
              {b.title}{star} <span className="badge">{isPresent ? present.size : stale.size}</span>
            </legend>
            <BookPicker books={books} disabled={preview} chosen={isPresent ? present : stale}
              set={isPresent ? setPresent : setStale} tone={isPresent ? 'good' : 'bad'} />
          </>, true,
        )
      }
      case 'visit_result':
        return wrap(
          <>
            <legend className="lbl">{b.title}{star}</legend>
            <div className="chips">
              {RESULT.map((r) => (
                <Chip key={r} disabled={preview} on={f.visit_result.includes(r)}
                  onClick={() => toggleStr('visit_result', r)}
                  tone={r === 'Buyurtma oldim' ? 'good' : ''}>{r}</Chip>
              ))}
            </div>
          </>, true,
        )
      case 'no_order_reason':
        // the question stops applying the moment an order is recorded
        if (tookOrder) return null
        return wrap(
          <>
            <legend className="lbl">{b.title}{star}</legend>
            <div className="chips">
              {NO_ORDER.map((n) => (
                <Chip key={n} disabled={preview} on={f.no_order_reason === n}
                  onClick={() => setF((x: any) => ({ ...x, no_order_reason: n }))}>{n}</Chip>
              ))}
            </div>
          </>, true,
        )
      case 'debt_status':
        return wrap(
          <>
            <legend className="lbl">{b.title}{star}</legend>
            <div className="chips">
              {DEBT.map((d) => (
                <Chip key={d} disabled={preview} on={f.debt_status === d}
                  onClick={() => setF((x: any) => ({ ...x, debt_status: d }))}
                  tone={d.startsWith("Muddati o'tgan") ? 'bad' : d === "Qarz yo'q" ? 'good' : ''}>{d}</Chip>
              ))}
            </div>
          </>, true,
        )
      case 'cash_collected':
        return wrap(
          <>
            <label htmlFor="cash">{b.title}{star}</label>
            <input id="cash" type="number" min="0" inputMode="numeric" disabled={preview}
              value={f.cash_collected ?? ''}
              onChange={(e) => setF((x: any) => ({ ...x, cash_collected: e.target.value }))} />
          </>,
        )
      case 'note':
        return wrap(
          <>
            <label htmlFor="note">{b.title}{star}</label>
            <textarea id="note" disabled={preview} value={f.note ?? ''}
              onChange={(e) => setF((x: any) => ({ ...x, note: e.target.value }))} />
          </>,
        )
      default:
        return null
    }
  }

  function renderBlock(b: Block): React.ReactNode {
    if (b.kind !== 'question') return <ContentBlock key={b.id} block={b} />
    if (b.hidden) return null
    if (b.coreKey) return renderCore(b)
    return (
      <QuestionField key={b.id} q={b} disabled={preview}
        value={answers[b.id] ?? null} error={errors[b.id]}
        onChange={(v) => setAnswer(b.id, v)} />
    )
  }

  // Consecutive questions share one card; content blocks and sections break it.
  function renderSection(s: Section, index: number) {
    const out: React.ReactNode[] = []
    let bucket: React.ReactNode[] = []
    const flush = () => {
      if (bucket.length) { out.push(<div className="card" key={`c${out.length}`}>{bucket}</div>); bucket = [] }
    }
    for (const b of s.blocks) {
      const el = renderBlock(b)
      if (!el) continue
      if (b.kind !== 'question' || b.coreKey === 'store_id' || b.coreKey === 'photos') {
        flush(); out.push(el)
      } else bucket.push(el)
    }
    flush()

    return (
      <section key={s.id}>
        {(s.title || s.description) && (
          <header className="sectionhead">
            {paged && <p className="sectioncount">{index + 1} / {sections.length}-bo&apos;lim</p>}
            {s.title && <h2>{s.title}</h2>}
            {s.description && <p className="sub">{s.description}</p>}
          </header>
        )}
        {out}
      </section>
    )
  }

  return (
    <>
      <div ref={top} />
      {doc.settings.showProgress && paged && (
        <div className="progress" role="progressbar" aria-valuemin={1}
          aria-valuemax={sections.length} aria-valuenow={si + 1}
          aria-label="Forma bosqichi">
          <span style={{ width: `${((si + 1) / sections.length) * 100}%` }} />
        </div>
      )}

      <div aria-live="polite">{msg && <div className={`alert ${msg.t}`}>{msg.m}</div>}</div>

      {shown.map((s) => renderSection(s, sections.indexOf(s)))}

      <div className="submitbar">
        <div className="inner">
          {paged ? (
            <>
              <button className="btn" disabled={busy} onClick={lastPage ? submit : goNext}>
                {busy ? 'Saqlanmoqda…' : lastPage ? 'Vizitni saqlash' : 'Keyingi'}
              </button>
              {trail.length > 0 && (
                <button className="btn btn-ghost" onClick={goBack} disabled={busy}>Orqaga</button>
              )}
            </>
          ) : (
            <button className="btn" disabled={busy || missingLabels.length > 0} onClick={submit}>
              {busy ? 'Saqlanmoqda…' : 'Vizitni saqlash'}
            </button>
          )}

          {missingLabels.length > 0
            ? <span className="hint" style={{ margin: 0 }} aria-live="polite">
                Qoldi: {missingLabels.join(', ')}
              </span>
            : !preview && f.lat && <span className="hint" style={{ margin: 0 }}>GPS yozildi</span>}
        </div>
      </div>
    </>
  )
}
