import { sql } from 'drizzle-orm'
import { asSystem, pgArray } from '@/lib/db'
import { readTab, storesSource } from '@/lib/sheets'

/**
 * The store directory comes from the "Sotuv uchun" spreadsheet.
 *
 *   "Do'konlar yangi"  name/code, type, responsible agent, sheet id, territory
 *   "Do'konlar"        name/code, grade (A++ ... C)
 *
 * (The tab names carry an apostrophe; an xlsx export drops it, the API does not.)
 *
 * The two tabs overlap but neither contains the other, so a shop is the union
 * of both, keyed by its code ("0104 Obid KTD" — the same string stores.code
 * holds). Planning is a pure function of the two grids so it can be checked
 * without a database; applying it is one transaction.
 */

export const GRADES = ['A++', 'A+', 'A', 'B', 'C'] as const
export type Grade = (typeof GRADES)[number]

export type SheetStore = {
  code: string
  name: string
  region: string
  letter_code: string | null
  territory: string | null
  store_type: string | null
  grade: Grade | null
  agent: string | null
  sheet_kod: string | null
}

export type StorePlan = {
  stores: SheetStore[]
  skipped: string[]       // rows that are not shops
  noTerritory: string[]
  noType: string[]
  rows: { master: number; graded: number }
}

export type StoreReport = {
  url: string
  tabs: { master: string; graded: string }
  total: number
  inserted: number
  updated: number
  retired: string[]
  skipped: string[]
  noTerritory: string[]
  noType: string[]
  at: string
}

// Rows in the sheet that are not shops: gifts, office pick-up, a blogger.
export const NOT_A_STORE = /^(hadya|xadiya|bloger)$|office|ofis|офис/i

// The code's last word names the kind of shop; used only when the master tab
// has no type for it (a shop that is only in the graded tab).
const TYPE_BY_SUFFIX: Record<string, string> = {
  KTD: "Kitob do'kon",
  KTB: "Kitob do'kon",
  KNS: 'Kanselyariya (Kanstovar)',
  ONL: 'Marketpleys / Onlayn platforma',
  OPT: 'Ulgurji savdo (Optovik)',
  TKD: "Tarmoq kitob do'kon",
  SUP: 'Supermarket',
  MSJ: 'Masjidlar',
  TLM: "Ta'lim muassasasi",
  BKT: 'Bekat',
  BKF: 'Book cafe',
}
const FOREIGN_PREFIX = /^(KG|KZ|KR|RUS|MISR)$/i

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
// the Sheets API gives "693", an xlsx export gives "693.0"
const plainNumber = (v: unknown) => clean(v).replace(/\.0+$/, '')

/** Index of the first row that looks like a header, and each wanted column in it. */
function header<K extends string>(grid: string[][], want: Record<K, RegExp>, fallback: Record<K, number>) {
  const at = grid.findIndex((row) => row.some((c) => want[Object.keys(want)[0] as K].test(clean(c))))
  const row = at >= 0 ? grid[at] : []
  const col = {} as Record<K, number>
  for (const k of Object.keys(want) as K[]) {
    const i = row.findIndex((c) => want[k].test(clean(c)))
    col[k] = i >= 0 ? i : fallback[k]
  }
  return { start: at >= 0 ? at + 1 : 1, col }
}

export function planStoreImport(master: string[][], graded: string[][]): StorePlan {
  const m = header(master, {
    name: /наименование|nomi/i, type: /тип|turi/i, agent: /агент|agent/i,
    kod: /^(код|kod)$/i, territory: /территория|hudud|territor/i,
  }, { name: 1, type: 2, agent: 3, kod: 4, territory: 5 })
  const g = header(graded, { name: /nomi|наименование/i, grade: /kategoriya|категория|grade/i },
    { name: 1, grade: 2 })

  const cell = (row: string[], i: number) => clean(row[i])
  const masterRows = master.slice(m.start).filter((r) => cell(r, m.col.name))
  const gradedRows = graded.slice(g.start).filter((r) => cell(r, g.col.name))

  const byCode = new Map<string, string[]>()
  for (const r of masterRows) byCode.set(cell(r, m.col.name), r)
  const gradeOf = new Map<string, string>()
  for (const r of gradedRows) gradeOf.set(cell(r, g.col.name), cell(r, g.col.grade))

  // Territory for a shop the master tab does not place: the most common
  // territory of master shops sharing its code prefix ("0104" -> "0104
  // Chilonzor"), else the province named by its first two digits ("30" ->
  // "30 Samarqand").
  const byPrefix = new Map<string, Map<string, number>>()
  const province = new Map<string, string>()
  for (const r of masterRows) {
    const t = cell(r, m.col.territory)
    if (!t) continue
    const p = cell(r, m.col.name).split(' ')[0]
    const counts = byPrefix.get(p) ?? new Map<string, number>()
    counts.set(t, (counts.get(t) ?? 0) + 1)
    byPrefix.set(p, counts)
    const head = t.split(' ')[0]
    if (/^\d{2}$/.test(head)) province.set(head, t)
  }
  const territoryFor = (code: string, row?: string[]) => {
    const own = row ? cell(row, m.col.territory) : ''
    if (own) return own
    const p = code.split(' ')[0]
    const counts = byPrefix.get(p)
    if (counts) return [...counts].sort((a, b) => b[1] - a[1])[0][0]
    if (/^\d{4}$/.test(p)) return province.get(p.slice(0, 2)) ?? null
    return null
  }

  const plan: StorePlan = {
    stores: [], skipped: [], noTerritory: [], noType: [],
    rows: { master: masterRows.length, graded: gradedRows.length },
  }
  const codes = [...new Set([...byCode.keys(), ...gradeOf.keys()])]
  for (const code of codes) {
    if (NOT_A_STORE.test(code)) { plan.skipped.push(code); continue }
    const row = byCode.get(code)
    const words = code.split(' ')
    const last = words[words.length - 1]
    const first = words[0]
    const suffix = words.length > 1 && /^[A-Z]{3}$/.test(last) ? last : null
    const prefixed = words.length > 1 && (/^\d{4}$/.test(first) || FOREIGN_PREFIX.test(first))

    const territory = territoryFor(code, row)
    const store_type = (row && cell(row, m.col.type)) || (suffix && TYPE_BY_SUFFIX[suffix]) || null
    const grade = gradeOf.get(code) ?? ''
    const nameWords = words.slice(prefixed ? 1 : 0, suffix ? -1 : undefined)

    plan.stores.push({
      code,
      name: nameWords.join(' ') || code,
      region: /^\d{4}$/.test(first) ? first : (territory?.split(' ')[0] ?? ''),
      letter_code: suffix,
      territory,
      store_type,
      grade: (GRADES as readonly string[]).includes(grade) ? (grade as Grade) : null,
      agent: (row && cell(row, m.col.agent)) || null,
      sheet_kod: (row && plainNumber(row[m.col.kod])) || null,
    })
    if (!territory) plan.noTerritory.push(code)
    if (!store_type) plan.noType.push(code)
  }
  return plan
}

export async function applyStoreImport(
  plan: StorePlan, source: { url: string; tab: string; gradeTab: string },
): Promise<StoreReport> {
  if (!plan.stores.length) {
    throw new Error("Varaqda birorta do'kon topilmadi — varaq nomi yoki ustunlar o'zgarganmi?")
  }
  const codes = plan.stores.map((s) => s.code)

  return asSystem(async (db) => {
    // A renamed tab or a half-deleted sheet would otherwise switch off most
    // of the shops in one press. Refuse and say so; nothing is written.
    const active = Number((await db.execute(sql`select count(*) n from stores where active`)).rows[0].n)
    const leaving = Number((await db.execute(sql`
      select count(*) n from stores
       where active and code <> all(${pgArray(codes)}::text[])`)).rows[0].n)
    if (active > 20 && leaving > active / 2) {
      throw new Error(`${leaving} ta do'kon (faollarning yarmidan ko'pi) o'chirilib qoladi — ` +
        "varaqni tekshiring, hech narsa o'zgartirilmadi")
    }

    await db.execute(sql`begin`)
    try {
      let inserted = 0
      const at = new Date().toISOString()
      for (const s of plan.stores) {
        // The sheet owns the directory fields. Name, channel and the MML
        // category of a shop we already have are kept: the sheet has no real
        // name column, and the category belongs to the MML import.
        const r = await db.execute(sql`
          insert into stores (code, name, region, letter_code, territory, store_type, grade,
                              agent, sheet_kod, active, synced_at)
          values (${s.code}, ${s.name}, ${s.region}, ${s.letter_code}, ${s.territory},
                  ${s.store_type}, ${s.grade}, ${s.agent}, ${s.sheet_kod}, true, ${at})
          on conflict (code) do update
             set territory = excluded.territory, store_type = excluded.store_type,
                 grade = excluded.grade, agent = excluded.agent, sheet_kod = excluded.sheet_kod,
                 active = true, synced_at = excluded.synced_at
          returning (xmax = 0) as inserted`)
        if ((r.rows[0] as { inserted: boolean }).inserted) inserted++
      }
      // left the sheet: inactive, not deleted — visits and plans reference it
      const retired = await db.execute(sql`
        update stores set active = false
         where active and code <> all(${pgArray(codes)}::text[])
        returning code`)
      await db.execute(sql`commit`)

      return {
        url: source.url,
        tabs: { master: source.tab, graded: source.gradeTab },
        total: plan.stores.length,
        inserted,
        updated: plan.stores.length - inserted,
        retired: (retired.rows as Array<{ code: string }>).map((x) => x.code),
        skipped: plan.skipped,
        noTerritory: plan.noTerritory,
        noType: plan.noType,
        at,
      }
    } catch (e) {
      await db.execute(sql`rollback`)
      throw e
    }
  })
}

export function storeSourceOrThrow() {
  const src = storesSource()
  if (!src) throw new Error("Do'konlar jadvali manzili sozlanmagan")
  return src
}

export async function readStoreTabs() {
  const src = storeSourceOrThrow()
  const [master, graded] = await Promise.all([readTab(src.tab, src.id), readTab(src.gradeTab, src.id)])
  return { src, master, graded }
}

export async function importStoresFromSheet(): Promise<StoreReport> {
  const { src, master, graded } = await readStoreTabs()
  return applyStoreImport(planStoreImport(master, graded), src)
}
