import { TYPE_META, type FormDoc, type QuestionBlock, type Section } from './types'

/**
 * One answer value per question, keyed by block id. The shape is decided by the
 * question type and is the same in the browser, in the request body, in jsonb
 * and in the export — so there is exactly one place to change it.
 *
 *   short_answer | paragraph | date | time   string
 *   multiple_choice | dropdown               string  (the option label, or the
 *                                            free text typed into "Boshqa")
 *   checkboxes                               string[]
 *   linear_scale | rating                    number
 *   grid_radio                               { [rowId]: string }
 *   grid_checkbox                            { [rowId]: string[] }
 *   file_upload                              { object_key, name, bytes, content_type }[]
 */
export type AnswerFile = { object_key: string; name: string; bytes?: number; content_type?: string }
export type AnswerValue =
  | string | number | string[]
  | Record<string, string | string[]>
  | AnswerFile[]
  | null

export type Answers = Record<string, AnswerValue>

export function isEmpty(v: AnswerValue): boolean {
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') {
    return Object.values(v).every((x) => x === null || x === '' || (Array.isArray(x) && !x.length))
  }
  return false
}

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/
const URL_RE = /^https?:\/\/[^\s]+$/i

/**
 * Returns an Uzbek message, or null when the answer is acceptable. Shared: the
 * form calls it per keystroke and POST /api/visits calls it again, so a client
 * that skips the check is held to exactly the same rule rather than a stricter
 * or looser one.
 */
export function validateAnswer(q: QuestionBlock, raw: AnswerValue): string | null {
  const empty = isEmpty(raw)
  if (empty) return q.required ? 'Bu savol majburiy' : null

  const meta = TYPE_META[q.type]
  if (!meta) return `Noma'lum savol turi`

  switch (q.type) {
    case 'short_answer':
    case 'paragraph': {
      if (typeof raw !== 'string') return 'Matn kiriting'
      const v = q.validation ?? { kind: 'none' as const }
      const text = raw.trim()
      if (v.kind === 'number' || v.kind === 'integer') {
        const n = Number(text.replace(',', '.'))
        if (!Number.isFinite(n)) return 'Raqam kiriting'
        if (v.kind === 'integer' && !Number.isInteger(n)) return 'Butun son kiriting'
        if (v.min != null && n < v.min) return `${v.min} dan kichik bo'lmasin`
        if (v.max != null && n > v.max) return `${v.max} dan katta bo'lmasin`
      }
      if (v.kind === 'email' && !EMAIL.test(text)) return 'To\'g\'ri email kiriting'
      if (v.kind === 'url' && !URL_RE.test(text)) return 'To\'g\'ri havola kiriting'
      if (v.kind === 'length') {
        if (v.min != null && text.length < v.min) return `Kamida ${v.min} belgi`
        if (v.max != null && text.length > v.max) return `Ko'pi bilan ${v.max} belgi`
      }
      return null
    }
    case 'multiple_choice':
    case 'dropdown': {
      if (typeof raw !== 'string') return 'Bitta variant tanlang'
      const other = q.options?.find((o) => o.other)
      const known = q.options?.some((o) => o.label === raw)
      if (!known && !other) return 'Bunday variant yo\'q'
      return null
    }
    case 'checkboxes': {
      if (!Array.isArray(raw)) return 'Variantlarni tanlang'
      const other = q.options?.find((o) => o.other)
      const labels = new Set(q.options?.map((o) => o.label))
      const unknown = (raw as string[]).filter((x) => !labels.has(x))
      if (unknown.length && !other) return 'Bunday variant yo\'q'
      if (unknown.length > 1) return 'Faqat bitta erkin javob'
      return null
    }
    case 'linear_scale': {
      const n = Number(raw)
      const s = q.scale ?? { min: 1, max: 5 }
      if (!Number.isFinite(n) || n < s.min || n > s.max) return `${s.min} dan ${s.max} gacha tanlang`
      return null
    }
    case 'rating': {
      const n = Number(raw)
      const max = q.rating?.max ?? 5
      if (!Number.isInteger(n) || n < 1 || n > max) return `1 dan ${max} gacha baholang`
      return null
    }
    case 'date':
      return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? null : 'Sanani tanlang'
    case 'time':
      return typeof raw === 'string' && /^\d{2}:\d{2}$/.test(raw) ? null : 'Vaqtni tanlang'
    case 'grid_radio':
    case 'grid_checkbox': {
      if (typeof raw !== 'object' || Array.isArray(raw)) return 'Jadvalni to\'ldiring'
      const rows = q.grid?.rows ?? []
      const cols = new Set((q.grid?.cols ?? []).map((c) => c.label))
      const v = raw as Record<string, string | string[]>
      for (const [rowId, picked] of Object.entries(v)) {
        if (!rows.some((r) => r.id === rowId)) return 'Noma\'lum qator'
        const list = Array.isArray(picked) ? picked : [picked]
        if (q.type === 'grid_radio' && Array.isArray(picked) && picked.length > 1) {
          return 'Har bir qatorda bitta javob'
        }
        for (const c of list) if (c && !cols.has(c)) return 'Noma\'lum ustun'
      }
      if (q.grid?.requireAllRows || q.required) {
        const answered = rows.filter((r) => {
          const p = v[r.id]
          return Array.isArray(p) ? p.length > 0 : !!p
        })
        if (q.grid?.requireAllRows && answered.length < rows.length) return 'Har bir qatorga javob bering'
      }
      return null
    }
    case 'file_upload': {
      if (!Array.isArray(raw)) return 'Fayl yuklang'
      const cfg = q.upload ?? { maxFiles: 3, maxMb: 10, accept: [] }
      const files = raw as AnswerFile[]
      if (files.length > cfg.maxFiles) return `Ko'pi bilan ${cfg.maxFiles} ta fayl`
      for (const f of files) {
        if (typeof f?.object_key !== 'string' || !f.object_key) return 'Fayl kaliti yo\'q'
        if (f.bytes && f.bytes > cfg.maxMb * 1024 * 1024) return `Har bir fayl ${cfg.maxMb} MB dan kichik bo'lsin`
        if (cfg.accept.length && f.content_type && !acceptable(f.content_type, cfg.accept)) {
          return 'Bu turdagi fayl qabul qilinmaydi'
        }
      }
      return null
    }
    default:
      return null
  }
}

export function acceptable(mime: string, accept: string[]): boolean {
  return accept.some((a) =>
    a.endsWith('/*') ? mime.startsWith(a.slice(0, -1)) : a === mime,
  )
}

/** One flat string per answer, for CSV, Sheets and the response viewer. */
export function answerText(q: QuestionBlock, v: AnswerValue): string {
  if (isEmpty(v)) return ''
  switch (q.type) {
    case 'checkboxes':
      return (v as string[]).join('; ')
    case 'grid_radio':
    case 'grid_checkbox': {
      const rows = q.grid?.rows ?? []
      const map = v as Record<string, string | string[]>
      return rows
        .filter((r) => !isEmpty(map[r.id] as AnswerValue))
        .map((r) => {
          const picked = map[r.id]
          return `${r.label}: ${Array.isArray(picked) ? picked.join(', ') : picked}`
        })
        .join('; ')
    }
    case 'file_upload':
      return (v as AnswerFile[]).map((f) => f.name || f.object_key).join('; ')
    default:
      return String(v)
  }
}

/**
 * Every value a summary should tally as one bar. A checkbox answer counts once
 * per option chosen; a grid counts once per "row: column" pair.
 */
export function answerFacets(q: QuestionBlock, v: AnswerValue): string[] {
  if (isEmpty(v)) return []
  switch (q.type) {
    case 'checkboxes':
      return v as string[]
    case 'grid_radio':
    case 'grid_checkbox': {
      const rows = q.grid?.rows ?? []
      const map = v as Record<string, string | string[]>
      return rows.flatMap((r) => {
        const picked = map[r.id]
        const list = Array.isArray(picked) ? picked : picked ? [picked] : []
        return list.map((c) => `${r.label}: ${c}`)
      })
    }
    case 'file_upload':
      return (v as AnswerFile[]).map(() => 'fayl')
    default:
      return [String(v)]
  }
}

/* ---------- section navigation ---------- */

/**
 * The next page for a respondent standing on `si` with these answers.
 * A single-choice answer carrying a jump wins over the section's own rule —
 * that is how Google Forms behaves, and it is what makes branching useful.
 * Returns null for "submit".
 */
export function nextSectionIndex(doc: FormDoc, si: number, answers: Answers): number | null {
  const s = doc.sections[si]
  if (!s) return null

  for (const b of s.blocks) {
    if (b.kind !== 'question' || b.hidden || !b.options) continue
    if (!TYPE_META[b.type]?.single) continue
    const picked = answers[b.id]
    if (typeof picked !== 'string') continue
    const opt = b.options.find((o) => o.label === picked && o.goTo)
    if (!opt?.goTo) continue
    if (opt.goTo === 'submit') return null
    if (opt.goTo === 'continue') break
    const j = doc.sections.findIndex((x) => x.id === opt.goTo)
    if (j >= 0) return j
  }

  if (s.next.type === 'submit') return null
  if (s.next.type === 'goto') {
    const j = doc.sections.findIndex((x) => x.id === (s.next as { sectionId: string }).sectionId)
    return j >= 0 ? j : null
  }
  return si + 1 < doc.sections.length ? si + 1 : null
}

/** Questions a respondent actually reached, so unvisited pages are not "missing". */
export function visibleQuestions(section: Section): QuestionBlock[] {
  return section.blocks.filter((b): b is QuestionBlock => b.kind === 'question' && !b.hidden)
}
