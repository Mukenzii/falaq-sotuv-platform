'use client'

import { useRef, useState } from 'react'
import { uploadImage } from '@/lib/shrinkImage'
import { applyTypeChange, blankOption, droppedByTypeChange, moveOption, videoEmbed } from '@/lib/form/doc'
import { CORE_LABEL, QUESTION_TYPES, TYPE_META, type Block, type MediaBlock, type Option, type QuestionBlock, type QuestionType, type Section, type TextBlock } from '@/lib/form/types'
import { QuestionField } from '@/app/vizit/yangi/QuestionFields'

/**
 * One card on the canvas. Selected, it opens into the controls for that block;
 * unselected it shows what a respondent would see, so the canvas still reads as
 * the form rather than as a settings screen.
 */

export type BlockEditorProps = {
  block: Block
  selected: boolean
  sections: Section[]
  index: number
  count: number
  /** false only at the very first / very last position in the whole form:
      a nudge at a section edge crosses into the neighbouring section */
  canUp: boolean
  canDown: boolean
  onSelect: () => void
  onChange: (next: Block, coalesceKey?: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  onDragStart: () => void
  onDragEnd: () => void
}

export default function BlockEditor(p: BlockEditorProps) {
  const { block, selected } = p

  return (
    <div
      id={`card-${block.id}`}
      className={`fcard ${selected ? 'sel' : ''} ${block.kind !== 'question' ? 'content' : ''}`}
      tabIndex={0}
      role="group"
      aria-label={cardLabel(block)}
      // click and focus both select: a mouse user taps the card, a keyboard user
      // tabs onto it, and a touch user gets the same result without any hover
      onClick={p.onSelect}
      onFocus={p.onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onSelect() }
      }}
    >
      <div className="fcard-grip" draggable onDragStart={p.onDragStart} onDragEnd={p.onDragEnd}
        aria-hidden="true" title="Tortib joyini o'zgartiring">⠿</div>

      {selected ? <Editing {...p} /> : <Preview block={block} />}

      <div className="fcard-actions">
        <button type="button" className="btn btn-ghost btn-sm" disabled={!p.canUp}
          aria-label="Yuqoriga ko'chirish" onClick={(e) => { e.stopPropagation(); p.onMove(-1) }}>↑</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!p.canDown}
          aria-label="Pastga ko'chirish" onClick={(e) => { e.stopPropagation(); p.onMove(1) }}>↓</button>
        <button type="button" className="btn btn-ghost btn-sm"
          aria-label="Nusxa olish" title="Nusxa olish"
          onClick={(e) => { e.stopPropagation(); p.onDuplicate() }}>⧉</button>
        {isCore(block) ? (
          <button type="button" className="btn btn-ghost btn-sm"
            aria-label={(block as QuestionBlock).hidden ? "Ko'rsatish" : 'Yashirish'}
            title="Asosiy savolni o'chirib bo'lmaydi — yashiring"
            onClick={(e) => {
              e.stopPropagation()
              p.onChange({ ...block, hidden: !(block as QuestionBlock).hidden } as Block)
            }}>{(block as QuestionBlock).hidden ? '◌' : '👁'}</button>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm danger"
            aria-label="O'chirish" title="O'chirish"
            onClick={(e) => { e.stopPropagation(); p.onDelete() }}>🗑</button>
        )}
      </div>
    </div>
  )
}

const isCore = (b: Block) => b.kind === 'question' && !!b.coreKey

function cardLabel(b: Block): string {
  if (b.kind === 'question') return `Savol: ${b.title || 'nomsiz'}`
  if (b.kind === 'text') return `Sarlavha: ${b.title || 'nomsiz'}`
  if (b.kind === 'image') return `Rasm: ${b.title || 'nomsiz'}`
  return `Video: ${b.title || 'nomsiz'}`
}

/* ---------- collapsed ---------- */

function Preview({ block }: { block: Block }) {
  if (block.kind === 'question') {
    return (
      <div className="fcard-preview">
        <p className="fq-title">
          {block.title || <em>Nomsiz savol</em>}
          {block.required && <span className="req"> *</span>}
          {block.hidden && <span className="badge">yashirin</span>}
        </p>
        {block.description && <p className="hint">{block.description}</p>}
        <p className="fq-type">
          {block.coreKey ? `asosiy · ${CORE_LABEL[block.coreKey]}` : TYPE_META[block.type]?.label}
          {block.options?.length ? ` · ${block.options.length} variant` : ''}
        </p>
      </div>
    )
  }
  if (block.kind === 'text') {
    return (
      <div className="fcard-preview">
        <p className="fq-title">{block.title || <em>Sarlavha</em>}</p>
        {block.description && <p className="hint">{block.description}</p>}
        <p className="fq-type">sarlavha va tavsif</p>
      </div>
    )
  }
  if (block.kind === 'image') {
    return (
      <div className="fcard-preview">
        {block.imageKey
          ? <img className="block-thumb" alt={block.title || ''} loading="lazy"
              key={block.imageKey} src={`/api/uploads/view?key=${encodeURIComponent(block.imageKey)}`} />
          : <p className="empty">Rasm yuklanmagan</p>}
        <p className="fq-type">rasm{block.title ? ` · ${block.title}` : ''}</p>
      </div>
    )
  }
  return (
    <div className="fcard-preview">
      <p className="fq-title">{block.title || <em>Video</em>}</p>
      <p className="fq-type">video · {block.url || 'havola yo\'q'}</p>
    </div>
  )
}

/* ---------- expanded ---------- */

function Editing(p: BlockEditorProps) {
  const { block, onChange } = p
  if (block.kind === 'question') return <QuestionEditor {...p} block={block} />
  if (block.kind === 'text') return <TextEditor block={block} onChange={onChange} />
  return <MediaEditor block={block} onChange={onChange} />
}

function TextEditor({ block, onChange }: { block: TextBlock; onChange: BlockEditorProps['onChange'] }) {
  return (
    <div className="fedit">
      <input className="fedit-title" placeholder="Sarlavha" aria-label="Sarlavha"
        value={block.title}
        onChange={(e) => onChange({ ...block, title: e.target.value }, `t-${block.id}`)} />
      <textarea className="fedit-desc" placeholder="Tavsif" aria-label="Tavsif" rows={3}
        value={block.description ?? ''}
        onChange={(e) => onChange({ ...block, description: e.target.value }, `d-${block.id}`)} />
    </div>
  )
}

function MediaEditor({ block, onChange }: { block: MediaBlock; onChange: BlockEditorProps['onChange'] }) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function pick(f: File | undefined) {
    if (!f) return
    setBusy(true); setErr('')
    try {
      const { objectKey } = await uploadImage(f)
      onChange({ ...block, imageKey: objectKey })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }

  const embed = block.kind === 'video' && block.url ? videoEmbed(block.url) : null

  return (
    <div className="fedit">
      {block.kind === 'image' ? (
        <>
          {block.imageKey
            ? <img className="block-thumb" alt={block.title || ''} key={block.imageKey}
                src={`/api/uploads/view?key=${encodeURIComponent(block.imageKey)}`} />
            : <p className="empty">Rasm yuklanmagan</p>}
          <input ref={file} type="file" hidden accept="image/jpeg,image/png,image/webp"
            onChange={(e) => pick(e.target.files?.[0])} />
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => file.current?.click()}>
            {busy ? 'Yuklanmoqda…' : block.imageKey ? 'Almashtirish' : 'Rasm yuklash'}
          </button>
        </>
      ) : (
        <>
          <label htmlFor={`url-${block.id}`}>YouTube yoki Vimeo havolasi</label>
          <input id={`url-${block.id}`} type="text" placeholder="https://youtu.be/…" value={block.url ?? ''}
            onChange={(e) => onChange({ ...block, url: e.target.value }, `u-${block.id}`)} />
          {block.url && !embed && <p className="fielderr">Bu havolani ko&apos;rsatib bo&apos;lmaydi</p>}
          {embed && (
            <div className="videoframe">
              <iframe src={embed} title={block.title || 'Video'} loading="lazy" allowFullScreen />
            </div>
          )}
        </>
      )}
      <input className="fedit-title" placeholder="Izoh (caption)" aria-label="Izoh"
        value={block.title}
        onChange={(e) => onChange({ ...block, title: e.target.value }, `c-${block.id}`)} />
      {err && <p className="fielderr">{err}</p>}
    </div>
  )
}

function QuestionEditor(p: BlockEditorProps & { block: QuestionBlock }) {
  const { block: q, onChange, sections } = p
  const meta = TYPE_META[q.type]
  const core = !!q.coreKey
  const image = useRef<HTMLInputElement>(null)
  const [imgBusy, setImgBusy] = useState(false)
  const [pendingType, setPendingType] = useState<{ to: QuestionType; lost: string[] } | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const set = (patch: Partial<QuestionBlock>, key?: string) => onChange({ ...q, ...patch } as Block, key)

  function changeType(to: QuestionType) {
    if (to === q.type) return
    const lost = droppedByTypeChange(q, to)
    // a silent retype throws away option lists that were typed by hand
    if (lost.length) { setPendingType({ to, lost }); return }
    onChange(applyTypeChange(q, to) as Block)
  }

  const setOptions = (options: Option[], key?: string) => set({ options }, key)

  async function pickImage(f: File | undefined) {
    if (!f) return
    setImgBusy(true)
    try {
      const { objectKey } = await uploadImage(f)
      set({ imageKey: objectKey })
    } finally {
      setImgBusy(false)
      if (image.current) image.current.value = ''
    }
  }

  return (
    <div className="fedit">
      <div className="fedit-head">
        <input className="fedit-title" placeholder="Savol matni" aria-label="Savol matni"
          data-title-for={q.id}
          value={q.title}
          onChange={(e) => set({ title: e.target.value }, `t-${q.id}`)} />

        {core ? (
          <span className="badge" title="Asosiy savol — turi o'zgarmaydi, chunki u ustunga yoziladi">
            {CORE_LABEL[q.coreKey!]}
          </span>
        ) : (
          <select className="fedit-type" aria-label="Savol turi" value={q.type}
            onChange={(e) => changeType(e.target.value as QuestionType)}>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_META[t].icon}  {TYPE_META[t].label}</option>
            ))}
          </select>
        )}
      </div>

      <textarea className="fedit-desc" placeholder="Tavsif (ixtiyoriy)" aria-label="Tavsif" rows={2}
        value={q.description ?? ''}
        onChange={(e) => set({ description: e.target.value }, `d-${q.id}`)} />

      {pendingType && (
        <div className="alert err" role="alertdialog" aria-label="Turini o'zgartirish">
          <p>Turini o&apos;zgartirsangiz yo&apos;qoladi: {pendingType.lost.join(', ')}.</p>
          <button type="button" className="btn btn-sm" onClick={() => {
            onChange(applyTypeChange(q, pendingType.to) as Block); setPendingType(null)
          }}>Baribir o&apos;zgartirish</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPendingType(null)}>
            Bekor qilish
          </button>
        </div>
      )}

      {q.imageKey && (
        <img className="block-thumb" alt="" key={q.imageKey}
          src={`/api/uploads/view?key=${encodeURIComponent(q.imageKey)}`} />
      )}

      {/* core option lists are the app's own enums — editing them here would
          desynchronise the typed column and every chart built on it */}
      {meta?.options && !core && (
        <OptionList q={q} sections={sections} onChange={setOptions} />
      )}

      {q.type === 'linear_scale' && !core && <ScaleEditor q={q} set={set} />}
      {q.type === 'rating' && !core && <RatingEditor q={q} set={set} />}
      {meta?.grid && !core && <GridEditor q={q} set={set} />}
      {q.type === 'file_upload' && !core && <UploadEditor q={q} set={set} />}

      <div className="fedit-foot">
        <label className="tick">
          <input type="checkbox" checked={q.required}
            onChange={(e) => set({ required: e.target.checked })} />
          Majburiy
        </label>

        <input ref={image} type="file" hidden accept="image/jpeg,image/png,image/webp"
          onChange={(e) => pickImage(e.target.files?.[0])} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={imgBusy}
          onClick={() => image.current?.click()}>
          {imgBusy ? 'Yuklanmoqda…' : q.imageKey ? 'Rasmni almashtirish' : 'Rasm'}
        </button>
        {q.imageKey && (
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => set({ imageKey: null })}>Rasmni olib tashlash</button>
        )}

        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showPreview}
          onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? 'Ko\'rinishni yopish' : 'Qanday ko\'rinadi'}
        </button>

        <span className="spacer" />

        {/* type-specific settings that do not belong on the face of the card */}
        <details className="fmenu">
          <summary aria-label="Qo'shimcha sozlamalar" title="Qo'shimcha sozlamalar">⋮</summary>
          <div className="fmenu-body">
            {meta?.group === 'text' && !core && <ValidationEditor q={q} set={set} />}
            {meta?.grid && (
              <label className="tick">
                <input type="checkbox" checked={!!q.grid?.requireAllRows}
                  onChange={(e) => set({ grid: { ...q.grid!, requireAllRows: e.target.checked } })} />
                Har bir qatorga javob shart
              </label>
            )}
            <label className="tick">
              <input type="checkbox" checked={q.hidden}
                onChange={(e) => set({ hidden: e.target.checked })} />
              Formadan yashirish
            </label>
            {core && (
              <p className="hint">
                Bu asosiy savol: nomi, tartibi va majburiyligi o&apos;zgaradi, lekin turi va
                variantlari hisobotlarga bog&apos;langani uchun qulflangan. O&apos;chirish
                o&apos;rniga yashiring.
              </p>
            )}
          </div>
        </details>
      </div>

      {showPreview && (
        <div className="fpreview">
          <QuestionField q={q} value={null} onChange={() => {}} disabled />
        </div>
      )}
    </div>
  )
}

/* ---------- option list ---------- */

function OptionList({
  q, sections, onChange,
}: {
  q: QuestionBlock
  sections: Section[]
  onChange: (o: Option[], key?: string) => void
}) {
  const opts = q.options ?? []
  const single = !!TYPE_META[q.type]?.single
  const hasOther = opts.some((o) => o.other)
  const drag = useRef<number | null>(null)

  const patch = (i: number, o: Partial<Option>, key?: string) =>
    onChange(opts.map((x, j) => (j === i ? { ...x, ...o } : x)), key)

  return (
    <div className="fopts">
      {opts.map((o, i) => (
        <div key={o.id} className="fopt"
          draggable onDragStart={() => { drag.current = i }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (drag.current !== null) onChange(moveOption(q, drag.current, i)); drag.current = null }}>
          <span className="fopt-grip" aria-hidden="true">⠿</span>
          <span className="fopt-mark" aria-hidden="true">
            {q.type === 'checkboxes' ? '☐' : q.type === 'dropdown' ? `${i + 1}.` : '○'}
          </span>
          {o.other ? (
            <span className="fopt-other">Boshqa… (javob beruvchi yozadi)</span>
          ) : (
            <input aria-label={`${i + 1}-variant`} value={o.label} placeholder={`${i + 1}-variant`}
              onChange={(e) => patch(i, { label: e.target.value }, `o-${o.id}`)} />
          )}

          {/* a jump belongs to the answer, which is the only place a single
              choice can carry one — checkboxes have no single next step */}
          {single && sections.length > 1 && (
            <select className="fopt-goto" aria-label={`${o.label || 'variant'} tanlansa`}
              value={o.goTo ?? 'continue'}
              onChange={(e) => patch(i, { goTo: e.target.value === 'continue' ? undefined : e.target.value })}>
              <option value="continue">keyingi bo&apos;lim</option>
              {sections.map((s, si) => (
                <option key={s.id} value={s.id}>{si + 1}. {s.title || 'nomsiz'}</option>
              ))}
              <option value="submit">yuborish</option>
            </select>
          )}

          <span className="fopt-nudge">
            <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0}
              aria-label="Yuqoriga" onClick={() => onChange(moveOption(q, i, i - 1))}>↑</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={i === opts.length - 1}
              aria-label="Pastga" onClick={() => onChange(moveOption(q, i, i + 1))}>↓</button>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={opts.length <= 1}
            aria-label={`${o.label || `${i + 1}-variant`} ni o'chirish`}
            onClick={() => onChange(opts.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}

      <div className="fopt-add">
        <button type="button" className="btn btn-ghost btn-sm"
          onClick={() => onChange([...opts, blankOption(`${opts.length + 1}-variant`)])}>
          Variant qo&apos;shish
        </button>
        {!hasOther && (
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => onChange([...opts, { ...blankOption('Boshqa'), other: true }])}>
            &quot;Boshqa&quot; qo&apos;shish
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------- type-specific configuration ---------- */

type Setter = (patch: Partial<QuestionBlock>, key?: string) => void

function ScaleEditor({ q, set }: { q: QuestionBlock; set: Setter }) {
  const s = q.scale ?? { min: 1, max: 5, minLabel: '', maxLabel: '' }
  return (
    <div className="fcfg">
      <label>
        Boshi
        <select value={s.min} onChange={(e) => set({ scale: { ...s, min: Number(e.target.value) } })}>
          <option value={0}>0</option><option value={1}>1</option>
        </select>
      </label>
      <label>
        Oxiri
        <select value={s.max} onChange={(e) => set({ scale: { ...s, max: Number(e.target.value) } })}>
          {[2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => n > s.min).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      <label>
        {s.min} belgisi
        <input value={s.minLabel ?? ''} placeholder="ixtiyoriy"
          onChange={(e) => set({ scale: { ...s, minLabel: e.target.value } }, `sl-${q.id}`)} />
      </label>
      <label>
        {s.max} belgisi
        <input value={s.maxLabel ?? ''} placeholder="ixtiyoriy"
          onChange={(e) => set({ scale: { ...s, maxLabel: e.target.value } }, `sh-${q.id}`)} />
      </label>
    </div>
  )
}

function RatingEditor({ q, set }: { q: QuestionBlock; set: Setter }) {
  const r = q.rating ?? { max: 5, icon: 'star' as const }
  return (
    <div className="fcfg">
      <label>
        Daraja
        <select value={r.max} onChange={(e) => set({ rating: { ...r, max: Number(e.target.value) } })}>
          {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label>
        Belgi
        <select value={r.icon} onChange={(e) => set({ rating: { ...r, icon: e.target.value as any } })}>
          <option value="star">★ yulduz</option>
          <option value="heart">♥ yurak</option>
          <option value="circle">● doira</option>
        </select>
      </label>
    </div>
  )
}

function GridEditor({ q, set }: { q: QuestionBlock; set: Setter }) {
  const g = q.grid ?? { rows: [], cols: [] }
  const edit = (which: 'rows' | 'cols', i: number, label: string) =>
    set({ grid: { ...g, [which]: g[which].map((x, j) => (j === i ? { ...x, label } : x)) } }, `g-${q.id}-${which}-${i}`)
  const add = (which: 'rows' | 'cols') =>
    set({ grid: { ...g, [which]: [...g[which], { id: `${which[0]}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: `${g[which].length + 1}-${which === 'rows' ? 'qator' : 'ustun'}` }] } })
  const drop = (which: 'rows' | 'cols', i: number) =>
    set({ grid: { ...g, [which]: g[which].filter((_, j) => j !== i) } })

  return (
    <div className="fgrid">
      {(['rows', 'cols'] as const).map((which) => (
        <div key={which}>
          <p className="lbl">{which === 'rows' ? 'Qatorlar' : 'Ustunlar'}</p>
          {g[which].map((x, i) => (
            <div key={x.id} className="fopt">
              <span className="fopt-mark" aria-hidden="true">{i + 1}.</span>
              <input aria-label={`${which === 'rows' ? 'Qator' : 'Ustun'} ${i + 1}`} value={x.label}
                onChange={(e) => edit(which, i, e.target.value)} />
              <button type="button" className="btn btn-ghost btn-sm" disabled={g[which].length <= 1}
                aria-label={`${x.label} ni o'chirish`} onClick={() => drop(which, i)}>×</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => add(which)}>
            {which === 'rows' ? "Qator qo'shish" : "Ustun qo'shish"}
          </button>
        </div>
      ))}
    </div>
  )
}

const ACCEPT_CHOICES: Array<[string, string]> = [
  ['image/*', 'Rasm'],
  ['application/pdf', 'PDF'],
  ['text/csv', 'CSV'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Word'],
]

function UploadEditor({ q, set }: { q: QuestionBlock; set: Setter }) {
  const u = q.upload ?? { maxFiles: 3, maxMb: 10, accept: [] }
  const toggle = (mime: string) =>
    set({ upload: { ...u, accept: u.accept.includes(mime) ? u.accept.filter((x) => x !== mime) : [...u.accept, mime] } })
  return (
    <div className="fcfg">
      <label>
        Fayl soni
        <input type="number" min={1} max={10} value={u.maxFiles}
          onChange={(e) => set({ upload: { ...u, maxFiles: Number(e.target.value) } })} />
      </label>
      <label>
        Eng katta hajm (MB)
        <input type="number" min={1} max={50} value={u.maxMb}
          onChange={(e) => set({ upload: { ...u, maxMb: Number(e.target.value) } })} />
      </label>
      <fieldset className="facc">
        <legend>Ruxsat etilgan turlar</legend>
        {ACCEPT_CHOICES.map(([mime, label]) => (
          <label key={mime} className="tick">
            <input type="checkbox" checked={u.accept.includes(mime)} onChange={() => toggle(mime)} />
            {label}
          </label>
        ))}
      </fieldset>
    </div>
  )
}

function ValidationEditor({ q, set }: { q: QuestionBlock; set: Setter }) {
  const v = q.validation ?? { kind: 'none' as const }
  const ranged = v.kind === 'number' || v.kind === 'integer' || v.kind === 'length'
  return (
    <div className="fcfg">
      <label>
        Tekshiruv
        <select value={v.kind ?? 'none'}
          onChange={(e) => set({ validation: { ...v, kind: e.target.value as any } })}>
          <option value="none">yo&apos;q</option>
          <option value="number">raqam</option>
          <option value="integer">butun son</option>
          <option value="email">email</option>
          <option value="url">havola</option>
          <option value="length">matn uzunligi</option>
        </select>
      </label>
      {ranged && (
        <>
          <label>
            Eng kami
            <input type="number" value={v.min ?? ''} onChange={(e) =>
              set({ validation: { ...v, min: e.target.value === '' ? null : Number(e.target.value) } })} />
          </label>
          <label>
            Eng ko&apos;pi
            <input type="number" value={v.max ?? ''} onChange={(e) =>
              set({ validation: { ...v, max: e.target.value === '' ? null : Number(e.target.value) } })} />
          </label>
        </>
      )}
    </div>
  )
}
