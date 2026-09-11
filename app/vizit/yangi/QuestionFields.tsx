'use client'

import { useRef, useState } from 'react'
import { Chip } from './Bits'
import { uploadFile } from '@/lib/shrinkImage'
import { videoEmbed } from '@/lib/form/doc'
import type { AnswerFile, AnswerValue } from '@/lib/form/answers'
import type { Block, QuestionBlock } from '@/lib/form/types'

/**
 * Every question type the builder offers, rendered the way a respondent answers
 * it. The editor's preview and the live form both come through here, so a type
 * cannot appear in the dropdown without actually working.
 */

const OTHER_PREFIX = ''   // "Boshqa" answers are stored as the typed text itself

type Props = {
  q: QuestionBlock
  value: AnswerValue
  onChange: (v: AnswerValue) => void
  error?: string | null
  disabled?: boolean
}

export function QuestionField(props: Props) {
  const { q, error } = props
  const id = `q-${q.id}`
  const describedBy = [q.description ? `${id}-d` : null, error ? `${id}-e` : null]
    .filter(Boolean).join(' ') || undefined

  const body = <Widget {...props} inputId={id} describedBy={describedBy} />

  // Types that are a single labelled control get a <label>; the rest are groups
  // of controls and need a fieldset/legend instead, or the label points nowhere.
  const grouped = ['multiple_choice', 'checkboxes', 'linear_scale', 'rating',
                   'grid_radio', 'grid_checkbox', 'file_upload'].includes(q.type)

  const head = (
    <>
      {q.imageKey && (
        <img className="qimage" alt="" loading="lazy"
          src={`/api/uploads/view?key=${encodeURIComponent(q.imageKey)}`} />
      )}
      {q.description && <p className="hint" id={`${id}-d`}>{q.description}</p>}
    </>
  )
  const tail = error
    ? <p className="fielderr" id={`${id}-e`}>{error}</p>
    : null

  if (grouped) {
    return (
      <fieldset className={`field ${error ? 'has-err' : ''}`}>
        <legend className="lbl">{q.title}{q.required && <span className="req" aria-hidden="true"> *</span>}</legend>
        {head}{body}{tail}
      </fieldset>
    )
  }
  return (
    <div className={`field ${error ? 'has-err' : ''}`}>
      <label htmlFor={id}>{q.title}{q.required && <span className="req" aria-hidden="true"> *</span>}</label>
      {head}{body}{tail}
    </div>
  )
}

function Widget({ q, value, onChange, disabled, inputId, describedBy }:
  Props & { inputId: string; describedBy?: string }) {

  switch (q.type) {
    case 'paragraph':
      return (
        <textarea id={inputId} aria-describedby={describedBy} disabled={disabled}
          value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      )

    case 'short_answer': {
      const v = q.validation
      const numeric = v?.kind === 'number' || v?.kind === 'integer'
      return (
        <input id={inputId} aria-describedby={describedBy} disabled={disabled}
          type={numeric ? 'number' : v?.kind === 'email' ? 'email' : v?.kind === 'url' ? 'url' : 'text'}
          {...(numeric ? {
            inputMode: 'decimal' as const,
            step: v?.kind === 'integer' ? 1 : 'any',
            min: v?.min ?? undefined,
            max: v?.max ?? undefined,
          } : {})}
          {...(v?.kind === 'length' ? { maxLength: v.max ?? undefined } : {})}
          value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      )
    }

    case 'date':
    case 'time':
      return (
        <input id={inputId} aria-describedby={describedBy} disabled={disabled}
          type={q.type} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      )

    case 'dropdown': {
      const other = q.options?.find((o) => o.other)
      const known = q.options?.some((o) => !o.other && o.label === value)
      return (
        <>
          <select id={inputId} aria-describedby={describedBy} disabled={disabled}
            value={known ? (value as string) : value && other ? '__other' : ''}
            onChange={(e) => onChange(e.target.value === '__other' ? '' : e.target.value || null)}>
            <option value="">— tanlang —</option>
            {q.options?.filter((o) => !o.other).map((o) => (
              <option key={o.id} value={o.label}>{o.label}</option>
            ))}
            {other && <option value="__other">{other.label || 'Boshqa…'}</option>}
          </select>
          {other && !known && (
            <input className="otherinput" type="text" placeholder="Boshqa javob" disabled={disabled}
              aria-label={other.label || 'Boshqa javob'}
              value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
          )}
        </>
      )
    }

    case 'multiple_choice': {
      const other = q.options?.find((o) => o.other)
      const known = q.options?.some((o) => !o.other && o.label === value)
      const otherOn = !!other && !known && value !== null && value !== undefined
      return (
        <>
          <div className="chips">
            {q.options?.filter((o) => !o.other).map((o) => (
              <Chip key={o.id} disabled={disabled} on={value === o.label}
                onClick={() => onChange(value === o.label ? null : o.label)}>{o.label}</Chip>
            ))}
            {other && (
              <Chip disabled={disabled} on={otherOn} onClick={() => onChange(otherOn ? null : '')}>
                {other.label || 'Boshqa…'}
              </Chip>
            )}
          </div>
          {otherOn && (
            <input className="otherinput" type="text" placeholder="Boshqa javob" disabled={disabled}
              aria-label={other!.label || 'Boshqa javob'}
              value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
          )}
        </>
      )
    }

    case 'checkboxes': {
      const list = Array.isArray(value) ? (value as string[]) : []
      const other = q.options?.find((o) => o.other)
      const labels = new Set(q.options?.filter((o) => !o.other).map((o) => o.label))
      const freeText = list.find((x) => !labels.has(x))
      const toggle = (label: string) =>
        onChange(list.includes(label) ? list.filter((x) => x !== label) : [...list, label])
      return (
        <>
          <div className="chips">
            {q.options?.filter((o) => !o.other).map((o) => (
              <Chip key={o.id} disabled={disabled} on={list.includes(o.label)}
                onClick={() => toggle(o.label)}>{o.label}</Chip>
            ))}
            {other && (
              <Chip disabled={disabled} on={freeText !== undefined}
                onClick={() => onChange(freeText !== undefined
                  ? list.filter((x) => labels.has(x))
                  : [...list, ''])}>
                {other.label || 'Boshqa…'}
              </Chip>
            )}
          </div>
          {other && freeText !== undefined && (
            <input className="otherinput" type="text" placeholder="Boshqa javob" disabled={disabled}
              aria-label={other.label || 'Boshqa javob'} value={freeText}
              onChange={(e) => onChange([...list.filter((x) => labels.has(x)), e.target.value])} />
          )}
        </>
      )
    }

    case 'linear_scale': {
      const s = q.scale ?? { min: 1, max: 5 }
      const steps = []
      for (let n = s.min; n <= s.max; n++) steps.push(n)
      return (
        <div className="scale">
          {s.minLabel && <span className="scale-end">{s.minLabel}</span>}
          <div className="scale-steps">
            {steps.map((n) => (
              <button key={n} type="button" disabled={disabled}
                aria-pressed={Number(value) === n} aria-label={String(n)}
                className={`scale-dot ${Number(value) === n ? 'on' : ''}`}
                onClick={() => onChange(Number(value) === n ? null : n)}>{n}</button>
            ))}
          </div>
          {s.maxLabel && <span className="scale-end">{s.maxLabel}</span>}
        </div>
      )
    }

    case 'rating': {
      const max = q.rating?.max ?? 5
      const glyph = q.rating?.icon === 'heart' ? '♥' : q.rating?.icon === 'circle' ? '●' : '★'
      const n = Number(value) || 0
      return (
        <div className="rating">
          {Array.from({ length: max }, (_, i) => i + 1).map((i) => (
            <button key={i} type="button" disabled={disabled}
              aria-pressed={n >= i} aria-label={`${i} / ${max}`}
              className={`star ${n >= i ? 'on' : ''}`}
              onClick={() => onChange(n === i ? null : i)}>{glyph}</button>
          ))}
          <span className="hint" style={{ margin: 0 }}>{n ? `${n} / ${max}` : ''}</span>
        </div>
      )
    }

    case 'grid_radio':
    case 'grid_checkbox': {
      const multi = q.type === 'grid_checkbox'
      const map = (value && typeof value === 'object' && !Array.isArray(value)
        ? value : {}) as Record<string, string | string[]>
      const rows = q.grid?.rows ?? []
      const cols = q.grid?.cols ?? []
      const set = (rowId: string, col: string) => {
        const cur = map[rowId]
        if (!multi) return onChange({ ...map, [rowId]: cur === col ? '' : col })
        const list = Array.isArray(cur) ? cur : cur ? [cur] : []
        return onChange({
          ...map,
          [rowId]: list.includes(col) ? list.filter((x) => x !== col) : [...list, col],
        })
      }
      return (
        <div className="gridwrap">
          <table className="gridq">
            <thead>
              <tr>
                <td />
                {cols.map((c) => <th key={c.id} scope="col">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cur = map[r.id]
                const list = Array.isArray(cur) ? cur : cur ? [cur] : []
                return (
                  <tr key={r.id}>
                    <th scope="row">{r.label}</th>
                    {cols.map((c) => (
                      <td key={c.id} data-label={c.label}>
                        <input
                          type={multi ? 'checkbox' : 'radio'}
                          name={`${q.id}-${r.id}`}
                          disabled={disabled}
                          checked={list.includes(c.label)}
                          aria-label={`${r.label}: ${c.label}`}
                          onChange={() => set(r.id, c.label)} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
    }

    case 'file_upload':
      return <FileField q={q} value={value} onChange={onChange} disabled={disabled} />

    default:
      return <p className="empty">Bu savol turi qo&apos;llab-quvvatlanmaydi</p>
  }
}

function FileField({ q, value, onChange, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')
  const files = Array.isArray(value) ? (value as AnswerFile[]) : []
  const cfg = q.upload ?? { maxFiles: 3, maxMb: 10, accept: [] }
  const full = files.length >= cfg.maxFiles

  async function add(picked: FileList | null) {
    if (!picked?.length) return
    setErr('')
    const room = cfg.maxFiles - files.length
    const chosen = [...picked].slice(0, room)
    if (picked.length > room) setErr(`Ko'pi bilan ${cfg.maxFiles} ta fayl`)

    const done: AnswerFile[] = []
    setBusy((n) => n + chosen.length)
    for (const file of chosen) {
      if (file.size > cfg.maxMb * 1024 * 1024) {
        setErr(`"${file.name}" ${cfg.maxMb} MB dan katta`)
        setBusy((n) => n - 1)
        continue
      }
      try {
        const up = await uploadFile(file)
        done.push({ object_key: up.objectKey, name: up.name, bytes: up.bytes, content_type: up.contentType })
      } catch (e) {
        setErr((e as Error).message)
      } finally {
        setBusy((n) => n - 1)
      }
    }
    if (done.length) onChange([...files, ...done])
    if (input.current) input.current.value = ''
  }

  return (
    <div>
      <ul className="filelist">
        {files.map((f) => (
          <li key={f.object_key}>
            <span>{f.name || f.object_key}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={disabled}
              aria-label={`${f.name} ni o'chirish`}
              onClick={() => onChange(files.filter((x) => x.object_key !== f.object_key))}>×</button>
          </li>
        ))}
        {busy > 0 && <li className="muted">Yuklanmoqda…</li>}
      </ul>
      <input ref={input} type="file" hidden multiple={cfg.maxFiles > 1}
        accept={cfg.accept.join(',') || undefined}
        onChange={(e) => add(e.target.files)} />
      <button type="button" className="btn btn-ghost" disabled={disabled || full}
        onClick={() => input.current?.click()}>
        Fayl tanlash
      </button>
      <p className="hint" aria-live="polite">
        {err ? <span style={{ color: 'var(--red)' }}>{err}</span>
             : `${files.length} / ${cfg.maxFiles} · ${cfg.maxMb} MB gacha`}
      </p>
    </div>
  )
}

/** Title, image and video blocks — content, never an answer. */
export function ContentBlock({ block }: { block: Block }) {
  if (block.kind === 'text') {
    return (
      <div className="textblock">
        {block.title && <h3>{block.title}</h3>}
        {block.description && <p>{block.description}</p>}
      </div>
    )
  }
  if (block.kind === 'image') {
    if (!block.imageKey) return null
    return (
      <figure className="mediablock">
        <img className="formimage" alt={block.title || ''} loading="lazy"
          src={`/api/uploads/view?key=${encodeURIComponent(block.imageKey)}`} />
        {block.title && <figcaption>{block.title}</figcaption>}
      </figure>
    )
  }
  if (block.kind === 'video') {
    const src = block.url ? videoEmbed(block.url) : null
    if (!src) {
      return <p className="empty">Video havolasi noto&apos;g&apos;ri</p>
    }
    return (
      <figure className="mediablock">
        <div className="videoframe">
          <iframe src={src} title={block.title || 'Video'} loading="lazy"
            allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen />
        </div>
        {block.title && <figcaption>{block.title}</figcaption>}
      </figure>
    )
  }
  return null
}
