import { sql } from 'drizzle-orm'
import { asSystem, pgArray } from '@/lib/db'
import { readTab, mmlSource } from '@/lib/sheets'
import { norm, parseMmlSheet, type SheetBook } from '@/lib/mmlParse'

export { norm }

/**
 * MML from the "Sotuv uchun" spreadsheet.
 *
 *   "MML"       one row per book with its category ("Kat."), one column per
 *               kind of shop; a cell is a requirement code: 1 majburiy,
 *               2 ixtiyoriy, 0 not required (lib/mmlParse.ts, db/35).
 *   "Kitoblar"  book -> category, for titles the matrix leaves out.
 *
 * Which column a store is measured against and what counts as on the shelf are
 * the views' business (db/21, db/35). This import only gets the codes and the
 * categories right.
 *
 * It is one transaction, and the sheet is the source of truth: the codes are
 * replaced wholesale, titles the platform lacks are added, and a book that is
 * no longer in the sheet loses its category (so it stops counting). A cell it
 * will not guess about stops the whole import — nothing is changed.
 */

export type MmlReport = {
  url: string
  tabs: { weights: string; books: string }
  columns: string[]
  books: { total: number; matched: number; aliased: string[]; created: string[]; notInSheet: string[] }
  skipped: string[]
  /** cells with a code, of any value */
  weights: number
  /** per shop column: how many titles it requires and how many are optional */
  targets: Array<{ column: string; required: number; optional: number }>
  at: string
}

export async function importMmlFromSheet(): Promise<MmlReport> {
  const src = mmlSource()
  if (!src) throw new Error('MML jadvali manzili sozlanmagan')

  const [matrix, booksGrid] = await Promise.all([readTab(src.tab, src.id), readTab(src.booksTab, src.id)])
  const parsed = parseMmlSheet(matrix, booksGrid)
  // a renamed tab or a half-deleted sheet must not wipe the must-list
  if (parsed.columns.length < 2 || parsed.books.filter((b) => b.codes.size).length < 5) {
    throw new Error(`"${src.tab}" varag'i kutilgan shaklda emas — hech narsa o'zgartirilmadi`)
  }

  return asSystem(async (db) => {
    const dbBooks = (await db.execute(sql`select id, title from books`)).rows as Array<{ id: string; title: string }>
    const aliases = (await db.execute(sql`select alias, book_id from book_aliases`)).rows as
      Array<{ alias: string; book_id: string }>
    const byTitle = new Map(dbBooks.map((b) => [norm(b.title), Number(b.id)]))
    const byAlias = new Map(aliases.map((a) => [norm(a.alias), Number(a.book_id)]))

    const aliased: string[] = []
    const created: string[] = []
    const idOf = new Map<SheetBook, number>()
    let weights = 0

    await db.execute(sql`begin`)
    try {
      for (const b of parsed.books) {
        let id = byTitle.get(norm(b.title))
        if (id === undefined && (id = byAlias.get(norm(b.title))) !== undefined) aliased.push(b.title)
        if (id === undefined) {
          const r = await db.execute(sql`
            insert into books (title, category) values (${b.title}, ${b.category})
            on conflict (title) do update set category = excluded.category
            returning id`)
          id = Number((r.rows[0] as { id: string }).id)
          created.push(b.title)
        }
        idOf.set(b, id)
        await db.execute(sql`update books set category = ${b.category} where id = ${id}`)
      }

      const ids = [...new Set(idOf.values())]
      const outside = await db.execute(sql`
        update books set category = null
         where category is not null and id <> all(${pgArray(ids)}::bigint[])
        returning title`)

      await db.execute(sql`delete from mml_weights`)
      for (const b of parsed.books) {
        for (const [column, code] of b.codes) {
          await db.execute(sql`
            insert into mml_weights (mml_column, book_id, code)
            values (${column}, ${idOf.get(b)!}, ${code})
            on conflict (mml_column, book_id) do update set code = excluded.code, weight = null`)
          weights++
        }
      }
      await db.execute(sql`commit`)

      // what the sheet now asks of each column
      const counts = (await db.execute(sql`
        select w.mml_column,
               count(*) filter (where w.code = 1)::int as required,
               count(*) filter (where w.code = 2)::int as optional
          from mml_weights w join books b on b.id = w.book_id and b.active
         group by 1`)).rows as Array<{ mml_column: string; required: number; optional: number }>
      const everything = Number((await db.execute(sql`
        select count(*) n from books where active and category is not null`)).rows[0].n)

      const targets = parsed.columns.map((column) => {
        const c = counts.find((x) => x.mml_column === column)
        return { column, required: Number(c?.required ?? 0), optional: Number(c?.optional ?? 0) }
      })
      // grade A++ owes every title in the sheet (v_store_mml_column)
      targets.unshift({ column: 'Barcha kitoblar (A++)', required: everything, optional: 0 })

      return {
        url: src.url,
        tabs: { weights: src.tab, books: src.booksTab },
        columns: parsed.columns,
        books: {
          total: parsed.books.length,
          matched: parsed.books.length - created.length,
          aliased,
          created,
          notInSheet: (outside.rows as Array<{ title: string }>).map((x) => x.title),
        },
        skipped: parsed.skipped,
        weights,
        targets,
        at: new Date().toISOString(),
      }
    } catch (e) {
      await db.execute(sql`rollback`)
      throw e
    }
  })
}
