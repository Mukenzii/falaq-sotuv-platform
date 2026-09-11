import { googleToken, hasServiceAccount } from '@/lib/sheets'
import { blankOption, newId } from './doc'
import type { Block, GridRow, Option, QuestionBlock, QuestionType } from './types'

/**
 * Reads a form through the real Google Forms API v1 — not a scrape and not the
 * FB_PUBLIC_LOAD_DATA blob, both of which need a signed-in browser.
 *
 * Setup, once, on the same service account the Sheets export already uses:
 *   1. Enable the Google Forms API in that Cloud project
 *   2. Share the form with the service-account email as a Viewer
 * Without step 2 Google answers 403 and there is nothing this app can do about
 * it, so that error is passed through with the email that needs the share.
 */

const SCOPE = 'https://www.googleapis.com/auth/forms.body.readonly'
const API = 'https://forms.googleapis.com/v1/forms'

export class GoogleFormsNotConfigured extends Error {
  constructor() {
    super(
      "Google Forms import sozlanmagan: .env da GOOGLE_SERVICE_ACCOUNT_EMAIL va " +
      "GOOGLE_PRIVATE_KEY bo'lishi, Cloud loyihada Forms API yoqilgan bo'lishi va " +
      "forma xizmat akkaunti bilan ulashilgan bo'lishi kerak.",
    )
  }
}

export function googleImportAvailable(): boolean {
  return hasServiceAccount()
}

/** Accepts a full edit/view URL or a bare id. */
export function parseFormId(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  const m = s.match(/\/forms\/d\/(?:e\/)?([A-Za-z0-9_-]{10,})/)
  if (m) return m[1]
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null
}

type GItem = Record<string, any>

export type GoogleImport = {
  formId: string
  title: string
  description: string
  blocks: Block[]
  /** items that have no equivalent here, named so the admin is not left guessing */
  skipped: string[]
}

export async function fetchGoogleForm(formId: string): Promise<GoogleImport> {
  if (!hasServiceAccount()) throw new GoogleFormsNotConfigured()

  const res = await fetch(`${API}/${encodeURIComponent(formId)}`, {
    headers: { authorization: `Bearer ${await googleToken(SCOPE)}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message ?? `Forms API ${res.status}`
    if (res.status === 403) {
      throw new Error(
        `${msg} — formani ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} bilan ulashing ` +
        `va Cloud loyihada Google Forms API ni yoqing.`,
      )
    }
    if (res.status === 404) throw new Error('Bunday Google forma topilmadi')
    throw new Error(msg)
  }

  const blocks: Block[] = []
  const skipped: string[] = []

  for (const item of (body.items ?? []) as GItem[]) {
    const title = String(item.title ?? '')
    const description = String(item.description ?? '')

    if (item.pageBreakItem) {
      // a page break is a section boundary, and sections are chosen by the
      // admin at the insertion point — importing one would move their content
      skipped.push(`bo'lim: ${title || 'nomsiz'}`)
      continue
    }
    if (item.textItem) {
      blocks.push({ id: newId('t'), kind: 'text', title, description })
      continue
    }
    if (item.videoItem) {
      const url = item.videoItem.video?.youtubeUri
      if (url) { blocks.push({ id: newId('v'), kind: 'video', title, description, url }); continue }
      skipped.push(`video: ${title || 'nomsiz'}`)
      continue
    }
    if (item.imageItem) {
      // Google serves the picture from a short-lived contentUri; copying it into
      // MinIO is a separate job, so the block is not created half-empty
      skipped.push(`rasm: ${title || 'nomsiz'}`)
      continue
    }
    if (item.questionGroupItem) {
      const q = gridQuestion(item, title, description)
      if (q) blocks.push(q)
      else skipped.push(`jadval: ${title || 'nomsiz'}`)
      continue
    }
    if (item.questionItem) {
      const q = simpleQuestion(item, title, description)
      if (q) blocks.push(q)
      else skipped.push(title || 'nomsiz savol')
      continue
    }
    skipped.push(title || 'nomsiz element')
  }

  return {
    formId: body.formId ?? formId,
    title: body.info?.title ?? 'Google forma',
    description: body.info?.description ?? '',
    blocks,
    skipped,
  }
}

function options(raw: any[], single: boolean): Option[] {
  return (raw ?? []).map((o) => {
    const opt: Option = o.isOther ? { ...blankOption('Boshqa'), other: true } : blankOption(String(o.value ?? ''))
    // Google's per-answer jumps name sections in the source form, which do not
    // exist here. Only "submit" survives; the rest are dropped rather than
    // pointed at an arbitrary local section.
    if (single && o.goToAction === 'SUBMIT_FORM') opt.goTo = 'submit'
    return opt
  })
}

function simpleQuestion(item: GItem, title: string, description: string): QuestionBlock | null {
  const q = item.questionItem.question ?? {}
  const base = {
    id: newId('q'),
    kind: 'question' as const,
    title: title || 'Savol',
    description,
    required: !!q.required,
    hidden: false,
  }

  if (q.choiceQuestion) {
    const map: Record<string, QuestionType> = {
      RADIO: 'multiple_choice', CHECKBOX: 'checkboxes', DROP_DOWN: 'dropdown',
    }
    const type = map[q.choiceQuestion.type] ?? 'multiple_choice'
    return { ...base, type, options: options(q.choiceQuestion.options, type !== 'checkboxes') }
  }
  if (q.textQuestion) {
    return { ...base, type: q.textQuestion.paragraph ? 'paragraph' : 'short_answer', validation: { kind: 'none' } }
  }
  if (q.scaleQuestion) {
    return {
      ...base, type: 'linear_scale',
      scale: {
        min: Number(q.scaleQuestion.low ?? 1),
        max: Number(q.scaleQuestion.high ?? 5),
        minLabel: q.scaleQuestion.lowLabel ?? '',
        maxLabel: q.scaleQuestion.highLabel ?? '',
      },
    }
  }
  if (q.ratingQuestion) {
    const icon = q.ratingQuestion.iconType === 'HEART' ? 'heart' : 'star'
    return { ...base, type: 'rating', rating: { max: Number(q.ratingQuestion.ratingScaleLevel ?? 5), icon } }
  }
  if (q.dateQuestion) return { ...base, type: 'date' }
  if (q.timeQuestion) return { ...base, type: 'time' }
  if (q.fileUploadQuestion) {
    const mb = Math.min(50, Math.max(1, Math.round(Number(q.fileUploadQuestion.maxFileSize ?? 0) / 1048576) || 10))
    return {
      ...base, type: 'file_upload',
      upload: { maxFiles: Math.min(10, Number(q.fileUploadQuestion.maxFiles ?? 3)), maxMb: mb, accept: ['image/*', 'application/pdf'] },
    }
  }
  return null
}

function gridQuestion(item: GItem, title: string, description: string): QuestionBlock | null {
  const grid = item.questionGroupItem.grid
  const questions: any[] = item.questionGroupItem.questions ?? []
  if (!grid || !questions.length) return null

  const rows: GridRow[] = questions.map((q) => ({
    id: newId('r'), label: String(q.rowQuestion?.title ?? ''),
  }))
  const cols: GridRow[] = (grid.columns?.options ?? []).map((o: any) => ({
    id: newId('c'), label: String(o.value ?? ''),
  }))
  return {
    id: newId('q'),
    kind: 'question',
    type: grid.columns?.type === 'CHECKBOX' ? 'grid_checkbox' : 'grid_radio',
    title: title || 'Jadval',
    description,
    required: questions.some((q) => q.required),
    hidden: false,
    grid: { rows, cols, requireAllRows: questions.every((q) => q.required) },
  }
}
