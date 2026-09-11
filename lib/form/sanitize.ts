import { newId } from './doc'
import {
  CORE_KEYS, DOC_SCHEMA_VERSION, TYPE_META,
  type Block, type CoreKey, type FormDoc, type Option, type QuestionBlock,
  type QuestionType, type Section, type SectionNext,
} from './types'

/**
 * Rebuilds a document from untrusted input, field by field.
 *
 * The editor is the only thing that writes this, but it posts a whole document
 * and the server cannot take it on trust: an extra key would be stored for ever,
 * and a core question retyped in the request body would send the wrong shape to
 * a typed column. Anything not named here does not survive.
 */

const ID_OK = /^[A-Za-z0-9_-]{1,64}$/
const CORE_TYPE: Record<CoreKey, QuestionType> = {
  store_id: 'dropdown',
  width_m: 'short_answer',
  height_m: 'short_answer',
  open_from: 'time',
  open_to: 'time',
  placement: 'checkboxes',
  facing: 'multiple_choice',
  shelf_heights: 'checkboxes',
  photos: 'file_upload',
  present_books: 'checkboxes',
  stale_books: 'checkboxes',
  visit_result: 'checkboxes',
  no_order_reason: 'multiple_choice',
  debt_status: 'multiple_choice',
  cash_collected: 'short_answer',
  note: 'paragraph',
}

const str = (v: unknown, max = 500): string =>
  typeof v === 'string' ? v.slice(0, max) : ''
const bool = (v: unknown): boolean => v === true
const int = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}
const id = (v: unknown, prefix: string): string =>
  typeof v === 'string' && ID_OK.test(v) ? v : newId(prefix)

function option(raw: any, sectionIds: Set<string>, single: boolean): Option {
  const o: Option = { id: id(raw?.id, 'o'), label: str(raw?.label, 200) }
  if (raw?.other === true) o.other = true
  if (single && typeof raw?.goTo === 'string') {
    const g = raw.goTo
    if (g === 'continue' || g === 'submit' || sectionIds.has(g)) o.goTo = g
  }
  return o
}

function question(raw: any, sectionIds: Set<string>): QuestionBlock {
  const coreKey: CoreKey | undefined =
    typeof raw?.coreKey === 'string' && (CORE_KEYS as readonly string[]).includes(raw.coreKey)
      ? (raw.coreKey as CoreKey)
      : undefined

  // A core question drives a typed column, so its widget is not the admin's to
  // change — only its wording, order, required flag and visibility are.
  const type: QuestionType = coreKey
    ? CORE_TYPE[coreKey]
    : TYPE_META[raw?.type as QuestionType] ? (raw.type as QuestionType) : 'short_answer'

  const meta = TYPE_META[type]
  const q: QuestionBlock = {
    id: coreKey ? `core_${coreKey}` : id(raw?.id, 'q'),
    kind: 'question',
    type,
    title: str(raw?.title, 300),
    required: bool(raw?.required),
    hidden: bool(raw?.hidden),
  }
  if (coreKey) q.coreKey = coreKey
  const desc = str(raw?.description, 1000)
  if (desc) q.description = desc
  if (typeof raw?.imageKey === 'string' && raw.imageKey) q.imageKey = raw.imageKey.slice(0, 300)

  // core option lists are the app's own enums, not editable content
  if (meta.options && !coreKey) {
    const list: Option[] = Array.isArray(raw?.options) ? raw.options.slice(0, 100) : []
    let other = false
    q.options = list.map((o) => option(o, sectionIds, !!meta.single)).filter((o) => {
      if (!o.other) return true
      if (other) return false     // only ever one free-text option
      other = true
      return true
    })
  }
  if (type === 'linear_scale') {
    const min = int(raw?.scale?.min, 0, 1, 1)
    q.scale = {
      min,
      max: int(raw?.scale?.max, min + 1, min + 10, Math.max(min + 1, 5)),
      minLabel: str(raw?.scale?.minLabel, 100),
      maxLabel: str(raw?.scale?.maxLabel, 100),
    }
  }
  if (type === 'rating') {
    const icon = raw?.rating?.icon
    q.rating = {
      max: int(raw?.rating?.max, 2, 10, 5),
      icon: icon === 'heart' || icon === 'circle' ? icon : 'star',
    }
  }
  if (meta.grid) {
    const cell = (r: any, p: string) => ({ id: id(r?.id, p), label: str(r?.label, 200) })
    q.grid = {
      rows: (Array.isArray(raw?.grid?.rows) ? raw.grid.rows.slice(0, 30) : []).map((r: any) => cell(r, 'r')),
      cols: (Array.isArray(raw?.grid?.cols) ? raw.grid.cols.slice(0, 20) : []).map((c: any) => cell(c, 'c')),
      requireAllRows: bool(raw?.grid?.requireAllRows),
    }
  }
  if (type === 'file_upload') {
    const accept: string[] = Array.isArray(raw?.upload?.accept)
      ? raw.upload.accept.filter((a: unknown) => typeof a === 'string').slice(0, 12).map((a: string) => a.slice(0, 60))
      : []
    q.upload = {
      maxFiles: int(raw?.upload?.maxFiles, 1, 10, 3),
      maxMb: int(raw?.upload?.maxMb, 1, 50, 10),
      accept,
    }
  }
  if (meta.group === 'text') {
    const kind = raw?.validation?.kind
    const ok = ['none', 'number', 'integer', 'email', 'url', 'length']
    q.validation = {
      kind: ok.includes(kind) ? kind : 'none',
      min: raw?.validation?.min === null || raw?.validation?.min === undefined || raw?.validation?.min === ''
        ? null : Number(raw.validation.min),
      max: raw?.validation?.max === null || raw?.validation?.max === undefined || raw?.validation?.max === ''
        ? null : Number(raw.validation.max),
      message: str(raw?.validation?.message, 200),
    }
    if (!Number.isFinite(q.validation.min as number)) q.validation.min = null
    if (!Number.isFinite(q.validation.max as number)) q.validation.max = null
  }
  return q
}

function block(raw: any, sectionIds: Set<string>): Block | null {
  switch (raw?.kind) {
    case 'question':
      return question(raw, sectionIds)
    case 'text':
      return { id: id(raw?.id, 't'), kind: 'text', title: str(raw?.title, 300), description: str(raw?.description, 3000) }
    case 'image':
      return {
        id: id(raw?.id, 'i'), kind: 'image', title: str(raw?.title, 300),
        description: str(raw?.description, 1000),
        imageKey: typeof raw?.imageKey === 'string' ? raw.imageKey.slice(0, 300) : null,
      }
    case 'video':
      return {
        id: id(raw?.id, 'v'), kind: 'video', title: str(raw?.title, 300),
        description: str(raw?.description, 1000), url: str(raw?.url, 500),
      }
    default:
      return null
  }
}

function next(raw: any, sectionIds: Set<string>): SectionNext {
  if (raw?.type === 'submit') return { type: 'submit' }
  if (raw?.type === 'goto' && typeof raw.sectionId === 'string' && sectionIds.has(raw.sectionId)) {
    return { type: 'goto', sectionId: raw.sectionId }
  }
  return { type: 'continue' }
}

export function sanitizeDoc(raw: any): FormDoc {
  const rawSections: any[] = Array.isArray(raw?.sections) ? raw.sections.slice(0, 60) : []

  // ids are resolved before routing, so a jump can only name a section that
  // survived sanitising rather than one the request invented
  const ids = rawSections.map((s) => id(s?.id, 's'))
  const sectionIds = new Set(ids)

  const sections: Section[] = rawSections.map((s, i) => ({
    id: ids[i],
    title: str(s?.title, 200),
    description: str(s?.description, 2000),
    next: next(s?.next, sectionIds),
    blocks: (Array.isArray(s?.blocks) ? s.blocks.slice(0, 200) : [])
      .map((b: any) => block(b, sectionIds))
      .filter((b: Block | null): b is Block => b !== null),
  }))

  const pagination = raw?.settings?.pagination === 'single' ? 'single' : 'sections'
  return {
    schemaVersion: DOC_SCHEMA_VERSION,
    title: str(raw?.title, 200) || 'Forma',
    description: str(raw?.description, 2000),
    settings: {
      pagination,
      showProgress: raw?.settings?.showProgress !== false,
      confirmText: str(raw?.settings?.confirmText, 300) || 'Javobingiz yozildi.',
    },
    sections: sections.length ? sections : [{ id: newId('s'), title: '', description: '', next: { type: 'continue' }, blocks: [] }],
  }
}
