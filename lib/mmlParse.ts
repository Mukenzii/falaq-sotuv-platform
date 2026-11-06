/**
 * Reading the "MML" tab of "Sotuv uchun", as the commercial team lays it out
 * (November 2026):
 *
 *   №  | Kitob | Kat. | <shop category> | <shop category> | …
 *
 * one row per BOOK with its book category (A++, A+, A, B, C, New), one column
 * per kind of SHOP, and in each cell a requirement code (db/35):
 *
 *   1   majburiy   the shop must carry the title
 *   2   ixtiyoriy  it may; never lowers MML, never listed as missing
 *   0   not required — older sheets wrote it where 2 is written now
 *
 * An empty cell is no code. The bottom "ИТОГО" row holds column totals, not a
 * book. Anything else in a cell — the old 0,5 / 0,3 / 0,2 shares, a stock
 * count, a typo — stops the import by name: guessing what it meant would put a
 * wrong title on every shelf of that kind. The older layout ("Kitob nomi",
 * "Kategoriya") is still read.
 *
 * Pure, so it is checked without Google or a database (tests/mml.test.mjs).
 */

export type MmlCode = 0 | 1 | 2
export type SheetBook = { title: string; category: string | null; codes: Map<string, MmlCode> }
export type ParsedMml = { columns: string[]; books: SheetBook[]; skipped: string[] }

/**
 * The sheet is hand-typed and the database was seeded elsewhere, so one title
 * is spelled differently in each. Uzbek Latin makes it worse: x and h are
 * interchangeable (nasixat / nasihat), the o' g' apostrophe appears as ' ’ ʻ ʼ
 * or is dropped, and "2 qism" is also written "(2)". Folding all of that away
 * is only used to pair rows up — nothing is renamed. Spellings it cannot fold
 * (digits vs words, Cyrillic) live in book_aliases.
 */
export const norm = (s: unknown): string => String(s ?? '')
  .toLowerCase()
  .replace(/[‘’ʻʼ`'´]/g, '')
  .replace(/x/g, 'h')
  .replace(/(\d+)\s*qism/g, '$1')
  .replace(/[^a-z0-9ʼ ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

// a header cell may wrap over two lines ("Ulgurji savdo\n(Optovik)")
const cell = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const TITLE_HEAD = /^kitob( nomi)?$/i
const CATEGORY_HEAD = /^(kat\.?|kategoriya)$/i
const TOTALS = /^(итого|итог|всего|jami|total)$/i

// " (new)" in an older sheet is the category "new"
const cleanCategory = (v: unknown): string | null => {
  const c = cell(v).replace(/^\((.*)\)$/, '$1').trim()
  return c || null
}

/** A cell's requirement code, null for an empty cell, 'invalid' for anything else. */
export function mmlCode(raw: unknown): MmlCode | null | 'invalid' {
  const s = String(raw ?? '').trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return n === 0 || n === 1 || n === 2 ? n : 'invalid'
}

/** The row holding both the title and the category headers. */
function headerRow(grid: string[][]): number {
  return grid.findIndex((r) => r.some((c) => TITLE_HEAD.test(cell(c))) && r.some((c) => CATEGORY_HEAD.test(cell(c))))
}

/**
 * The MML tab and the Kitoblar tab -> books with categories and codes. Throws,
 * naming the cell, on anything it will not guess about.
 */
export function parseMmlSheet(matrix: string[][], booksGrid: string[][]): ParsedMml {
  const h = headerRow(matrix)
  if (h < 0) throw new Error(`MML varag'ida "Kitob" va "Kat." ustunlari topilmadi`)
  const head = matrix[h].map(cell)
  const titleCol = head.findIndex((c) => TITLE_HEAD.test(c))
  const catCol = head.findIndex((c) => CATEGORY_HEAD.test(c))
  // shop categories are every named column to the right of the book category
  const columns = head.map((name, at) => ({ name, at })).filter((c) => c.at > catCol && c.name)
  const seenCol = new Set<string>()
  for (const c of columns) {
    if (seenCol.has(c.name)) throw new Error(`MML varag'ida "${c.name}" ustuni ikki marta bor`)
    seenCol.add(c.name)
  }

  const books = new Map<string, SheetBook>()
  const skipped: string[] = []
  for (const row of matrix.slice(h + 1)) {
    const title = cell(row[titleCol])
    if (!title || TOTALS.test(title)) continue                // the totals row
    if (title.length < 3) { skipped.push(title); continue }   // a stray test row such as "dd"
    if (books.has(norm(title))) {
      throw new Error(`MML varag'ida "${title}" ikki marta yozilgan — qaysi biri to'g'ri ekanini aniqlab bo'lmaydi`)
    }
    const codes = new Map<string, MmlCode>()
    for (const col of columns) {
      const code = mmlCode(row[col.at])
      if (code === 'invalid') {
        throw new Error(`MML varag'ida noto'g'ri qiymat: "${title}" / "${col.name}": "${row[col.at]}" — `
          + `faqat 1 (majburiy), 2 (ixtiyoriy) yoki 0 bo'lishi mumkin`)
      }
      if (code !== null) codes.set(col.name, code)
    }
    books.set(norm(title), { title, category: cleanCategory(row[catCol]), codes })
  }

  // The Kitoblar tab: titles the matrix does not list, and a category for a
  // matrix row that left "Kat." empty. The matrix's own category wins.
  const kh = headerRow(booksGrid)
  if (kh >= 0) {
    const khead = booksGrid[kh].map(cell)
    const kt = khead.findIndex((c) => TITLE_HEAD.test(c))
    const kc = khead.findIndex((c) => CATEGORY_HEAD.test(c))
    for (const row of booksGrid.slice(kh + 1)) {
      const title = cell(row[kt])
      if (!title || TOTALS.test(title)) continue
      if (title.length < 3) { skipped.push(title); continue }
      const category = kc >= 0 ? cleanCategory(row[kc]) : null
      const hit = books.get(norm(title))
      if (hit) { if (!hit.category) hit.category = category }
      else books.set(norm(title), { title, category, codes: new Map() })
    }
  }

  return { columns: columns.map((c) => c.name), books: [...books.values()], skipped: [...new Set(skipped)] }
}
