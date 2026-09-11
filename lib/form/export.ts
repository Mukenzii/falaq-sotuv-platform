import type { FormDoc, QuestionBlock } from './types'

export type VersionRow = { version: number; status: string; doc: FormDoc }

/**
 * The extra columns an export needs: every admin-created question in the
 * published form, in form order, followed by any question that only exists in
 * an older version but still has answers stored against it.
 *
 * Without that tail an export silently loses answers the moment a question is
 * deleted, which is the one thing a response archive must not do.
 */
export function questionColumns(versions: VersionRow[], usedKeys: Iterable<string>): QuestionBlock[] {
  const newest = new Map<string, QuestionBlock>()
  for (const v of [...versions].sort((a, b) => b.version - a.version)) {
    for (const s of v.doc?.sections ?? []) {
      for (const b of s.blocks ?? []) {
        if (b.kind === 'question' && !b.coreKey && !newest.has(b.id)) newest.set(b.id, b)
      }
    }
  }

  const out: QuestionBlock[] = []
  const seen = new Set<string>()
  const published = versions.find((v) => v.status === 'published')
  for (const s of published?.doc?.sections ?? []) {
    for (const b of s.blocks) {
      if (b.kind === 'question' && !b.coreKey) { out.push(b); seen.add(b.id) }
    }
  }
  for (const key of new Set(usedKeys)) {
    if (seen.has(key)) continue
    const q = newest.get(key)
    if (q) { out.push({ ...q, title: `${q.title} (arxiv)` }); seen.add(key) }
  }
  return out
}
