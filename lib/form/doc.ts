import {
  CORE_KEYS, DOC_SCHEMA_VERSION, TYPE_META,
  type Block, type CoreKey, type FormDoc, type Option, type QuestionBlock,
  type QuestionType, type Section,
} from './types'

/* ---------- ids ---------- */

/**
 * Ids are strings and are generated wherever a block is created — including on
 * duplicate and on import. A duplicated block that kept its source id would
 * collide in visit_answers and silently overwrite the original's answers.
 */
let counter = 0
export function newId(prefix: string): string {
  counter = (counter + 1) % 100000
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`
}

/* ---------- constructors ---------- */

export function blankOption(label = ''): Option {
  return { id: newId('o'), label }
}

export function blankQuestion(type: QuestionType = 'multiple_choice'): QuestionBlock {
  const q: QuestionBlock = {
    id: newId('q'),
    kind: 'question',
    type,
    title: '',
    required: false,
    hidden: false,
  }
  return withTypeDefaults(q, type)
}

/** Fills in the configuration a type needs, leaving anything already set alone. */
export function withTypeDefaults(q: QuestionBlock, type: QuestionType): QuestionBlock {
  const meta = TYPE_META[type]
  const next: QuestionBlock = { ...q, type }
  if (meta.options && !next.options?.length) {
    next.options = [blankOption('1-variant')]
  }
  if (type === 'linear_scale' && !next.scale) {
    next.scale = { min: 1, max: 5, minLabel: '', maxLabel: '' }
  }
  if (type === 'rating' && !next.rating) {
    next.rating = { max: 5, icon: 'star' }
  }
  if (meta.grid && !next.grid) {
    next.grid = {
      rows: [{ id: newId('r'), label: '1-qator' }],
      cols: [{ id: newId('c'), label: '1-ustun' }],
    }
  }
  if (type === 'file_upload' && !next.upload) {
    next.upload = { maxFiles: 3, maxMb: 10, accept: ['image/*', 'application/pdf'] }
  }
  if (!next.validation) next.validation = { kind: 'none' }
  return next
}

/**
 * Which settings a type change would throw away. The editor warns with this
 * before applying, because options typed by hand are expensive to retype.
 */
export function droppedByTypeChange(q: QuestionBlock, to: QuestionType): string[] {
  const from = TYPE_META[q.type]
  const next = TYPE_META[to]
  const lost: string[] = []
  if (from.options && !next.options && q.options?.some((o) => o.label.trim())) {
    lost.push(`${q.options.filter((o) => o.label.trim()).length} ta variant`)
  }
  if (from.single && !next.single && q.options?.some((o) => o.goTo)) {
    lost.push("variantga bog'langan o'tish")
  }
  if (from.grid && !next.grid && (q.grid?.rows.length || q.grid?.cols.length)) {
    lost.push('jadval qatorlari va ustunlari')
  }
  if (q.type === 'linear_scale' && to !== 'linear_scale' && q.scale) lost.push('shkala chegaralari')
  if (q.type === 'rating' && to !== 'rating' && q.rating) lost.push('baholash sozlamasi')
  if (q.type === 'file_upload' && to !== 'file_upload' && q.upload) lost.push('fayl cheklovlari')
  if (q.validation?.kind && q.validation.kind !== 'none' && next.group !== 'text') {
    lost.push('tekshiruv qoidasi')
  }
  return lost
}

/** Strips what the new type cannot carry, so a stale config never leaks back. */
export function applyTypeChange(q: QuestionBlock, to: QuestionType): QuestionBlock {
  const meta = TYPE_META[to]
  const next: QuestionBlock = { ...q, type: to }
  if (!meta.options) delete next.options
  else if (!meta.single) next.options = next.options?.map(({ goTo, ...o }) => o)
  if (!meta.grid) delete next.grid
  if (to !== 'linear_scale') delete next.scale
  if (to !== 'rating') delete next.rating
  if (to !== 'file_upload') delete next.upload
  if (meta.group !== 'text') next.validation = { kind: 'none' }
  return withTypeDefaults(next, to)
}

export function blankSection(title = ''): Section {
  return { id: newId('s'), title, description: '', next: { type: 'continue' }, blocks: [] }
}

export function blankText(): Block {
  return { id: newId('t'), kind: 'text', title: '', description: '' }
}

export function blankImage(imageKey: string, caption = ''): Block {
  return { id: newId('i'), kind: 'image', title: caption, imageKey }
}

export function blankVideo(url = ''): Block {
  return { id: newId('v'), kind: 'video', title: '', url }
}

export function emptyDoc(): FormDoc {
  const s = blankSection('')
  s.blocks = [blankQuestion('short_answer')]
  return {
    schemaVersion: DOC_SCHEMA_VERSION,
    title: 'Yangi forma',
    description: '',
    settings: { pagination: 'sections', showProgress: true, confirmText: 'Javobingiz yozildi.' },
    sections: [s],
  }
}

/* ---------- lookup ---------- */

export type Loc = { si: number; bi: number }

export function locate(doc: FormDoc, blockId: string): Loc | null {
  for (let si = 0; si < doc.sections.length; si++) {
    const bi = doc.sections[si].blocks.findIndex((b) => b.id === blockId)
    if (bi >= 0) return { si, bi }
  }
  return null
}

export function findBlock(doc: FormDoc, blockId: string): Block | null {
  const l = locate(doc, blockId)
  return l ? doc.sections[l.si].blocks[l.bi] : null
}

export function sectionIndex(doc: FormDoc, sectionId: string): number {
  return doc.sections.findIndex((s) => s.id === sectionId)
}

export function allBlocks(doc: FormDoc): Block[] {
  return doc.sections.flatMap((s) => s.blocks)
}

export function allQuestions(doc: FormDoc): QuestionBlock[] {
  return allBlocks(doc).filter((b): b is QuestionBlock => b.kind === 'question')
}

export function coreQuestion(doc: FormDoc, key: CoreKey): QuestionBlock | undefined {
  return allQuestions(doc).find((q) => q.coreKey === key)
}

/** Deep clone that is available in both the browser and node without a polyfill. */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

/* ---------- structural edits (all pure: doc in, new doc out) ---------- */

/**
 * Where a new block lands. Google Forms inserts directly after whatever is
 * selected; with nothing selected it appends to the last section. Both are
 * expressed here so every insert path — question, title, image, video —
 * shares one rule.
 */
export function insertionPoint(doc: FormDoc, selectedId: string | null): Loc {
  if (selectedId) {
    const l = locate(doc, selectedId)
    if (l) return { si: l.si, bi: l.bi + 1 }
    const si = sectionIndex(doc, selectedId)
    // a selected section header inserts at the top of that section
    if (si >= 0) return { si, bi: 0 }
  }
  const si = Math.max(0, doc.sections.length - 1)
  return { si, bi: doc.sections[si]?.blocks.length ?? 0 }
}

export function insertBlock(doc: FormDoc, block: Block, selectedId: string | null): FormDoc {
  const next = clone(doc)
  if (!next.sections.length) next.sections.push(blankSection(''))
  const { si, bi } = insertionPoint(next, selectedId)
  next.sections[si].blocks.splice(bi, 0, block)
  return next
}

/**
 * A section boundary splits at the insertion point: everything after it moves
 * into the new section. That is what makes it a real boundary rather than a
 * heading — content after the break genuinely belongs to the next page.
 */
export function insertSection(doc: FormDoc, selectedId: string | null, title = ''): { doc: FormDoc; id: string } {
  const next = clone(doc)
  if (!next.sections.length) {
    const s = blankSection(title)
    next.sections.push(s)
    return { doc: next, id: s.id }
  }
  const { si, bi } = insertionPoint(next, selectedId)
  const tail = next.sections[si].blocks.splice(bi)
  const s = blankSection(title)
  s.blocks = tail
  s.next = next.sections[si].next
  next.sections[si].next = { type: 'continue' }
  next.sections.splice(si + 1, 0, s)
  return { doc: next, id: s.id }
}

export function updateBlock(doc: FormDoc, blockId: string, patch: Partial<Block>): FormDoc {
  const next = clone(doc)
  const l = locate(next, blockId)
  if (!l) return doc
  next.sections[l.si].blocks[l.bi] = { ...next.sections[l.si].blocks[l.bi], ...patch } as Block
  return next
}

export function replaceBlock(doc: FormDoc, blockId: string, block: Block): FormDoc {
  const next = clone(doc)
  const l = locate(next, blockId)
  if (!l) return doc
  next.sections[l.si].blocks[l.bi] = block
  return next
}

export function updateSection(doc: FormDoc, sectionId: string, patch: Partial<Section>): FormDoc {
  const next = clone(doc)
  const si = sectionIndex(next, sectionId)
  if (si < 0) return doc
  next.sections[si] = { ...next.sections[si], ...patch }
  return next
}

/** Fresh ids throughout, including options and grid rows/cols. */
export function freshBlock(b: Block): Block {
  const copy = clone(b) as Block
  copy.id = newId(b.kind === 'question' ? 'q' : b.kind === 'text' ? 't' : b.kind === 'image' ? 'i' : 'v')
  if (copy.kind === 'question') {
    // a copy of a core question would be a second writer for one typed column
    delete copy.coreKey
    copy.options = copy.options?.map((o) => ({ ...o, id: newId('o') }))
    if (copy.grid) {
      copy.grid = {
        ...copy.grid,
        rows: copy.grid.rows.map((r) => ({ ...r, id: newId('r') })),
        cols: copy.grid.cols.map((c) => ({ ...c, id: newId('c') })),
      }
    }
  }
  return copy
}

export function duplicateBlock(doc: FormDoc, blockId: string): { doc: FormDoc; id: string } | null {
  const l = locate(doc, blockId)
  if (!l) return null
  const next = clone(doc)
  const copy = freshBlock(next.sections[l.si].blocks[l.bi])
  if (copy.kind === 'question' && copy.title) copy.title = `${copy.title} (nusxa)`
  next.sections[l.si].blocks.splice(l.bi + 1, 0, copy)
  return { doc: next, id: copy.id }
}

export function duplicateSection(doc: FormDoc, sectionId: string): { doc: FormDoc; id: string } | null {
  const si = sectionIndex(doc, sectionId)
  if (si < 0) return null
  const next = clone(doc)
  const src = next.sections[si]
  const copy: Section = {
    id: newId('s'),
    title: src.title ? `${src.title} (nusxa)` : '',
    description: src.description,
    // routing is not copied: it would point the copy at the original's target
    next: { type: 'continue' },
    blocks: src.blocks.map(freshBlock),
  }
  next.sections.splice(si + 1, 0, copy)
  return { doc: next, id: copy.id }
}

export function removeBlock(doc: FormDoc, blockId: string): FormDoc {
  const next = clone(doc)
  const l = locate(next, blockId)
  if (!l) return doc
  next.sections[l.si].blocks.splice(l.bi, 1)
  return next
}

/**
 * Deleting a section is two different intentions — drop the page, or drop the
 * page and everything on it — so the caller has to say which.
 */
export function removeSection(doc: FormDoc, sectionId: string, keepBlocks: boolean): FormDoc {
  const si = sectionIndex(doc, sectionId)
  if (si < 0 || doc.sections.length <= 1) return doc
  const next = clone(doc)
  const [gone] = next.sections.splice(si, 1)
  if (keepBlocks && gone.blocks.length) {
    const into = si > 0 ? si - 1 : 0
    next.sections[into].blocks.push(...gone.blocks)
  }
  // any route that pointed here has to go somewhere real again
  for (const s of next.sections) {
    if (s.next.type === 'goto' && s.next.sectionId === sectionId) s.next = { type: 'continue' }
    for (const b of s.blocks) {
      if (b.kind !== 'question' || !b.options) continue
      b.options = b.options.map((o) => (o.goTo === sectionId ? { ...o, goTo: undefined } : o))
    }
  }
  return next
}

/** Move by one slot, crossing into the neighbouring section at either end. */
export function nudgeBlock(doc: FormDoc, blockId: string, dir: -1 | 1): FormDoc {
  const l = locate(doc, blockId)
  if (!l) return doc
  const next = clone(doc)
  const from = next.sections[l.si]
  const to = l.bi + dir
  if (to >= 0 && to < from.blocks.length) {
    const [b] = from.blocks.splice(l.bi, 1)
    from.blocks.splice(to, 0, b)
    return next
  }
  const nsi = l.si + dir
  if (nsi < 0 || nsi >= next.sections.length) return doc
  const [b] = from.blocks.splice(l.bi, 1)
  const target = next.sections[nsi]
  target.blocks.splice(dir === 1 ? 0 : target.blocks.length, 0, b)
  return next
}

/** Drag-and-drop: drop `blockId` at `index` inside `sectionId`. */
export function moveBlockTo(doc: FormDoc, blockId: string, sectionId: string, index: number): FormDoc {
  const l = locate(doc, blockId)
  const tsi = sectionIndex(doc, sectionId)
  if (!l || tsi < 0) return doc
  const next = clone(doc)
  const [b] = next.sections[l.si].blocks.splice(l.bi, 1)
  let at = index
  if (l.si === tsi && l.bi < index) at -= 1
  next.sections[tsi].blocks.splice(Math.max(0, Math.min(at, next.sections[tsi].blocks.length)), 0, b)
  return next
}

export function moveSection(doc: FormDoc, sectionId: string, dir: -1 | 1): FormDoc {
  const si = sectionIndex(doc, sectionId)
  const to = si + dir
  if (si < 0 || to < 0 || to >= doc.sections.length) return doc
  const next = clone(doc)
  const [s] = next.sections.splice(si, 1)
  next.sections.splice(to, 0, s)
  return next
}

export function moveOption(q: QuestionBlock, from: number, to: number): Option[] {
  const opts = [...(q.options ?? [])]
  if (to < 0 || to >= opts.length) return opts
  const [o] = opts.splice(from, 1)
  opts.splice(to, 0, o)
  return opts
}

/* ---------- validation ---------- */

export type DocIssue = { level: 'error' | 'warning'; where: string; message: string }

const YOUTUBE = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]{6,}/i
const VIMEO = /^(https?:\/\/)?(www\.)?(player\.)?vimeo\.com\/(video\/)?\d+/i

export function isVideoUrl(url: string): boolean {
  return YOUTUBE.test(url.trim()) || VIMEO.test(url.trim())
}

/** A watchable embed src, or null when the url is not one we can frame. */
export function videoEmbed(url: string): string | null {
  const u = url.trim()
  const yt = u.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{6,})/i)
  if (YOUTUBE.test(u) && yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i)
  if (VIMEO.test(u) && vm) return `https://player.vimeo.com/video/${vm[1]}`
  return null
}

/**
 * Everything publishing refuses, plus the softer problems worth showing while
 * editing. Run on the client for live feedback and again on the server, which
 * is the only copy that decides.
 */
export function validateDoc(doc: FormDoc): DocIssue[] {
  const issues: DocIssue[] = []
  const ids = new Set<string>()
  const sectionIds = new Set(doc.sections.map((s) => s.id))
  const seenCore = new Set<string>()

  if (!doc.title?.trim()) issues.push({ level: 'error', where: 'forma', message: 'Forma nomi kerak' })
  if (!doc.sections.length) issues.push({ level: 'error', where: 'forma', message: "Kamida bitta bo'lim kerak" })

  for (const s of doc.sections) {
    if (ids.has(s.id)) issues.push({ level: 'error', where: s.id, message: 'Takrorlangan id' })
    ids.add(s.id)

    if (s.next.type === 'goto' && !sectionIds.has(s.next.sectionId)) {
      issues.push({ level: 'error', where: s.id, message: `"${s.title || 'nomsiz'}" mavjud bo'lmagan bo'limga o'tadi` })
    }

    for (const b of s.blocks) {
      if (ids.has(b.id)) issues.push({ level: 'error', where: b.id, message: 'Takrorlangan id' })
      ids.add(b.id)

      if (b.kind === 'question') {
        if (b.coreKey) {
          if (!CORE_KEYS.includes(b.coreKey)) {
            issues.push({ level: 'error', where: b.id, message: `Noma'lum asosiy savol: ${b.coreKey}` })
          }
          if (seenCore.has(b.coreKey)) {
            issues.push({ level: 'error', where: b.id, message: `"${b.title}" ikki marta` })
          }
          seenCore.add(b.coreKey)
        }
        if (!b.title.trim()) {
          issues.push({ level: 'error', where: b.id, message: 'Savol matni bo\'sh' })
        }
        if (!TYPE_META[b.type]) {
          issues.push({ level: 'error', where: b.id, message: `Noma'lum savol turi: ${b.type}` })
          continue
        }
        const meta = TYPE_META[b.type]
        if (meta.options && !b.coreKey) {
          const labelled = (b.options ?? []).filter((o) => o.label.trim() || o.other)
          if (!labelled.length) {
            issues.push({ level: 'error', where: b.id, message: `"${b.title || 'savol'}" uchun variant yo'q` })
          }
          if ((b.options ?? []).filter((o) => o.other).length > 1) {
            issues.push({ level: 'error', where: b.id, message: '"Boshqa" faqat bitta bo\'lishi mumkin' })
          }
          const dupes = new Set<string>()
          for (const o of b.options ?? []) {
            const k = o.label.trim().toLowerCase()
            if (!k) continue
            if (dupes.has(k)) issues.push({ level: 'warning', where: b.id, message: `Takrorlangan variant: ${o.label}` })
            dupes.add(k)
          }
          for (const o of b.options ?? []) {
            if (o.goTo && o.goTo !== 'continue' && o.goTo !== 'submit' && !sectionIds.has(o.goTo)) {
              issues.push({ level: 'error', where: b.id, message: `"${o.label}" mavjud bo'lmagan bo'limga o'tadi` })
            }
          }
        }
        if (b.type === 'linear_scale' && b.scale) {
          if (!(b.scale.max > b.scale.min)) {
            issues.push({ level: 'error', where: b.id, message: 'Shkala chegarasi noto\'g\'ri' })
          } else if (b.scale.max - b.scale.min > 10) {
            issues.push({ level: 'error', where: b.id, message: 'Shkala eng ko\'pi 11 pog\'ona' })
          }
        }
        if (b.type === 'rating' && b.rating && (b.rating.max < 2 || b.rating.max > 10)) {
          issues.push({ level: 'error', where: b.id, message: 'Baholash 2 dan 10 gacha bo\'lishi kerak' })
        }
        if (meta.grid) {
          if (!b.grid?.rows.filter((r) => r.label.trim()).length) {
            issues.push({ level: 'error', where: b.id, message: `"${b.title || 'jadval'}" qatorsiz` })
          }
          if (!b.grid?.cols.filter((c) => c.label.trim()).length) {
            issues.push({ level: 'error', where: b.id, message: `"${b.title || 'jadval'}" ustunsiz` })
          }
        }
        if (b.type === 'file_upload' && b.upload) {
          if (b.upload.maxFiles < 1 || b.upload.maxFiles > 10) {
            issues.push({ level: 'error', where: b.id, message: 'Fayl soni 1 dan 10 gacha' })
          }
          if (b.upload.maxMb < 1 || b.upload.maxMb > 50) {
            issues.push({ level: 'error', where: b.id, message: 'Fayl hajmi 1 dan 50 MB gacha' })
          }
        }
        if (b.validation && b.validation.kind === 'length') {
          const { min, max } = b.validation
          if (min != null && max != null && min > max) {
            issues.push({ level: 'error', where: b.id, message: 'Uzunlik chegarasi teskari' })
          }
        }
      }

      if (b.kind === 'image' && !b.imageKey) {
        issues.push({ level: 'error', where: b.id, message: 'Rasm yuklanmagan' })
      }
      if (b.kind === 'video') {
        if (!b.url?.trim()) issues.push({ level: 'error', where: b.id, message: 'Video havolasi yo\'q' })
        else if (!isVideoUrl(b.url)) {
          issues.push({ level: 'error', where: b.id, message: 'Faqat YouTube yoki Vimeo havolasi' })
        }
      }
    }
  }

  for (const k of CORE_KEYS) {
    if (!seenCore.has(k)) {
      issues.push({ level: 'error', where: 'forma', message: `Asosiy savol yo'qolgan: ${k}` })
    }
  }

  issues.push(...routingIssues(doc))
  return issues
}

/**
 * Sections form a graph: the section's own "next", plus a jump per answer on
 * any single-choice question inside it. A cycle means a respondent can be sent
 * round for ever, so publishing refuses one.
 */
export function routingIssues(doc: FormDoc): DocIssue[] {
  const out: DocIssue[] = []
  const index = new Map(doc.sections.map((s, i) => [s.id, i]))
  const edges = doc.sections.map((s, i) => {
    const to = new Set<number>()
    const add = (t: SectionTarget) => {
      if (t === 'submit') return
      if (t === 'continue') { if (i + 1 < doc.sections.length) to.add(i + 1); return }
      const j = index.get(t)
      if (j !== undefined) to.add(j)
    }
    add(s.next.type === 'goto' ? s.next.sectionId : s.next.type)
    for (const b of s.blocks) {
      if (b.kind !== 'question' || !b.options) continue
      for (const o of b.options) if (o.goTo) add(o.goTo)
    }
    return [...to]
  })

  const WHITE = 0, GREY = 1, BLACK = 2
  const colour = new Array(doc.sections.length).fill(WHITE)
  const stack: number[] = []
  let cycle: number[] | null = null

  const walk = (i: number) => {
    if (cycle) return
    colour[i] = GREY
    stack.push(i)
    for (const j of edges[i]) {
      if (colour[j] === GREY) {
        cycle = stack.slice(stack.indexOf(j))
        return
      }
      if (colour[j] === WHITE) { walk(j); if (cycle) return }
    }
    stack.pop()
    colour[i] = BLACK
  }
  for (let i = 0; i < doc.sections.length && !cycle; i++) if (colour[i] === WHITE) walk(i)

  if (cycle) {
    const names = (cycle as number[]).map((i) => doc.sections[i].title || `${i + 1}-bo'lim`).join(' → ')
    out.push({ level: 'error', where: doc.sections[(cycle as number[])[0]].id, message: `O'tishlar aylanma: ${names}` })
  }

  // a section nobody can reach is not fatal, but it is almost always a mistake
  const seen = new Set<number>([0])
  const queue = [0]
  while (queue.length) {
    const i = queue.shift()!
    for (const j of edges[i] ?? []) if (!seen.has(j)) { seen.add(j); queue.push(j) }
  }
  doc.sections.forEach((s, i) => {
    if (!seen.has(i)) {
      out.push({ level: 'warning', where: s.id, message: `"${s.title || `${i + 1}-bo'lim`}" ga hech qanday yo'l yo'q` })
    }
  })
  return out
}

type SectionTarget = string

export const errorsOnly = (issues: DocIssue[]) => issues.filter((i) => i.level === 'error')
