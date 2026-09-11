import { isEmpty, type AnswerValue, type Answers } from './answers'
import { nextSectionIndex } from './answers'
import type { CoreKey, FormDoc, QuestionBlock, Section } from './types'

/**
 * The 16 originals are not stored in visit_answers — they are typed columns on
 * `visits`, which every dashboard, view and export is built on. This maps a
 * submitted visit body onto those keys so one "is it answered?" rule serves the
 * form, the API and the required-check, instead of three that can drift.
 */
export function coreValue(key: CoreKey, b: any): AnswerValue {
  switch (key) {
    case 'store_id':        return b?.store_id ? String(b.store_id) : null
    case 'width_m':         return b?.width_m ?? null
    case 'height_m':        return b?.height_m ?? null
    case 'open_from':       return b?.open_from ?? null
    case 'open_to':         return b?.open_to ?? null
    case 'placement':       return Array.isArray(b?.placement) ? b.placement : []
    case 'facing':          return b?.facing ?? null
    case 'shelf_heights':   return Array.isArray(b?.shelf_heights) ? b.shelf_heights : []
    case 'photos':          return Array.isArray(b?.photos) ? b.photos.map((p: any) => String(p?.object_key ?? '')) : []
    case 'present_books':   return (b?.present_book_ids ?? []).map(String)
    case 'stale_books':     return (b?.stale_book_ids ?? []).map(String)
    case 'visit_result':    return Array.isArray(b?.visit_result) ? b.visit_result : []
    case 'no_order_reason': return b?.no_order_reason ?? null
    case 'debt_status':     return b?.debt_status ?? null
    case 'cash_collected':  return b?.cash_collected ?? null
    case 'note':            return b?.note ?? null
  }
}

export const tookOrder = (b: any): boolean =>
  Array.isArray(b?.visit_result) && b.visit_result.includes('Buyurtma oldim')

/**
 * The sections a respondent actually passed through, recomputed from the
 * answers rather than trusted from the request. Requiring a question on a page
 * the branching never showed would reject a perfectly good response.
 */
export function traversedSections(doc: FormDoc, answers: Answers): Section[] {
  if (doc.settings.pagination === 'single') return doc.sections
  const out: Section[] = []
  const seen = new Set<number>()
  let i: number | null = 0
  while (i !== null && i < doc.sections.length && !seen.has(i)) {
    seen.add(i)
    out.push(doc.sections[i])
    i = nextSectionIndex(doc, i, answers)
  }
  return out
}

/** Core question answered? Same rule the form uses to build its "Qoldi" list. */
export function coreFilled(q: QuestionBlock, body: any): boolean {
  if (!q.coreKey) return true
  // the form hides this entirely once an order was taken, so it cannot be missing
  if (q.coreKey === 'no_order_reason' && tookOrder(body)) return true
  const v = coreValue(q.coreKey, body)
  if (q.coreKey === 'width_m' || q.coreKey === 'height_m') {
    const n = Number(String(v ?? '').replace(',', '.'))
    return Number.isFinite(n) && n > 0
  }
  if (q.coreKey === 'cash_collected') {
    const n = Number(String(v ?? '').replace(',', '.'))
    return v !== null && v !== '' && Number.isFinite(n)
  }
  return !isEmpty(v)
}
