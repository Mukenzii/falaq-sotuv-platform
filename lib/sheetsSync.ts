import { sql } from 'drizzle-orm'
import { asSystem, type Tx } from '@/lib/db'
import { writeVisitTabs, masterTabTitle, isConfigured, SheetsNotConfigured } from '@/lib/sheets'
import { questionColumns } from '@/lib/form/export'
import { answerText, type AnswerValue } from '@/lib/form/answers'
import type { CoreKey, FormDoc, QuestionBlock } from '@/lib/form/types'

/**
 * Pushing every visit to the spreadsheet, as the system, on every change.
 *
 * The sheet reads like a Google Forms response sheet: one row per visit, one
 * column per form question in the order the form shows them, headed with the
 * question's own title. The 16 original questions live in typed columns on
 * `visits`, the admin-added ones in visit_answers; both become ordinary
 * columns here, followed by any removed question that still has answers.
 *
 * Since db/25 that sheet is written once per region as well: the same header
 * and the same rows, split by the region of the shop each visit was filed
 * against, so a region head opens their own tab instead of filtering 600 rows.
 * Every region has a tab from the start, whether or not anyone has been there,
 * and each is titled by regions.tab_title ("01 Toshkent") rather than by the
 * region's name ("Toshkent shahri") — see db/30. The master tab still holds
 * every visit — splitting a sheet is only useful if
 * nothing stops being visible somewhere.
 *
 * Decisions worth not re-litigating:
 *
 * 1. It runs as asSystem, not as the person who triggered it. The trigger is a
 *    manager saving a visit — an RLS-scoped rewrite would replace everyone
 *    else's rows with their own. Whoever saves, the sheet gets everything.
 *
 * 2. It rewrites the tab rather than appending the one new visit. At a few
 *    visits a day that costs nothing and buys exactness: no duplicate row if a
 *    retry overlaps, and no drift when an admin adds a question and columns move.
 */

type Cell = string | number

/** First header cell. The writer only ever overwrites a tab that starts with it. */
export const VISITS_MARK = 'Vizit vaqti'

const list = (a: unknown) => (Array.isArray(a) ? a.join('; ') : '')
const num = (x: unknown): Cell => (x === null || x === undefined || x === '' ? '' : Number(x))

function coreCell(key: CoreKey, v: any, base: string): Cell {
  switch (key) {
    case 'store_id':        return v.dokon
    case 'width_m':         return num(v.width_m)
    case 'height_m':        return num(v.height_m)
    case 'open_from':       return v.open_from ?? ''
    case 'open_to':         return v.open_to ?? ''
    case 'placement':       return list(v.placement)
    case 'facing':          return v.facing ?? ''
    case 'shelf_heights':   return list(v.shelf_heights)
    // links open through the app, which checks the viewer may see the visit
    case 'photos':          return (v.photos ?? [])
      .map((k: string) => (base ? `${base}/api/uploads/view?key=${encodeURIComponent(k)}` : k)).join('\n')
    case 'present_books':   return list(v.present_books)
    case 'stale_books':     return list(v.stale_books)
    case 'visit_result':    return list(v.visit_result)
    case 'no_order_reason': return v.no_order_reason ?? ''
    case 'debt_status':     return v.debt_status ?? ''
    case 'cash_collected':  return num(v.cash_collected)
    case 'note':            return v.note ?? ''
  }
}

export type VisitTab = { title: string; rows: Cell[][] }

/**
 * The whole visits tab, header first, plus the same thing split by region.
 * Exported so it can be checked without Google.
 */
export async function buildVisitSheet(db: Tx): Promise<{ master: Cell[][]; regions: VisitTab[] }> {
  const base = (process.env.APP_PUBLIC_URL ?? '').trim().replace(/\/+$/, '')

  const versions = (await db.execute(sql`
    select version, status, doc from form_versions order by version desc`)).rows as
    Array<{ version: number; status: string; doc: FormDoc }>

  const visits = (await db.execute(sql`
    select v.id, to_char(v.visited_at, 'YYYY-MM-DD HH24:MI') vaqt, u.full_name manager,
           s.region_code, g.name hudud, g.tab_title, g.sort hudud_sort,
           s.code dokon, v.width_m, v.height_m,
           to_char(v.open_from, 'HH24:MI') open_from, to_char(v.open_to, 'HH24:MI') open_to,
           v.placement, v.facing::text facing, v.shelf_heights, v.visit_result,
           v.no_order_reason, v.debt_status, v.cash_collected, v.note, v.lat, v.lng,
           (select array_agg(b.title order by b.title) from visit_books vb join books b on b.id = vb.book_id
             where vb.visit_id = v.id and vb.status = 'present') present_books,
           (select array_agg(b.title order by b.title) from visit_books vb join books b on b.id = vb.book_id
             where vb.visit_id = v.id and vb.status = 'stale') stale_books,
           (select array_agg(p.object_key order by p.created_at) from visit_photos p
             where p.visit_id = v.id) photos
      from visits v
      join users u on u.id = v.manager_id
      join stores s on s.id = v.store_id
      left join regions g on g.code = s.region_code
     -- oldest first, like a Forms response sheet: a new visit lands at the bottom
     order by v.visited_at, v.id`)).rows as any[]

  const answers = (await db.execute(sql`
    select va.visit_id, va.block_key, va.value
      from visit_answers va join visits v on v.id = va.visit_id`)).rows as
    Array<{ visit_id: string; block_key: string; value: AnswerValue }>

  // every question of the published form, core and custom, in form order
  const published = versions.find((v) => v.status === 'published')
  const inForm: QuestionBlock[] = []
  for (const sec of published?.doc?.sections ?? []) {
    for (const b of sec.blocks ?? []) if (b.kind === 'question') inForm.push(b)
  }
  const seen = new Set(inForm.map((q) => q.id))
  // removed questions that still hold answers, already titled "(arxiv)"
  const archived = questionColumns(versions, answers.map((a) => a.block_key)).filter((q) => !seen.has(q.id))

  const byVisit = new Map<string, Map<string, AnswerValue>>()
  for (const a of answers) {
    if (!byVisit.has(a.visit_id)) byVisit.set(a.visit_id, new Map())
    byVisit.get(a.visit_id)!.set(a.block_key, a.value)
  }

  const header: Cell[] = [VISITS_MARK, 'Menejer', 'Hudud', ...inForm.map((q) => q.title),
    ...archived.map((q) => q.title), 'GPS', 'Vizit havolasi']

  /**
   * Every region gets a tab, in code order, whether or not anyone has been
   * there yet. An empty one is not noise: it is where a region head looks, and
   * a tab that only appears once the first visit lands reads as a system that
   * has lost their region. Keyed by code rather than by name, because two
   * regions share a tab name bar the number in front of it ("01 Toshkent" and
   * "10 Toshkent").
   */
  const allRegions = (await db.execute(sql`
    select code, tab_title, sort from regions order by sort`)).rows as
    Array<{ code: string; tab_title: string; sort: number }>
  const byRegion = new Map<string, { title: string; sort: number; rows: Cell[][] }>()
  for (const r of allRegions) {
    byRegion.set(r.code, { title: r.tab_title, sort: r.sort, rows: [] })
  }
  const rows = visits.map((v) => {
    const mine = byVisit.get(v.id)
    const answer = (q: QuestionBlock): Cell =>
      q.coreKey ? coreCell(q.coreKey, v, base) : answerText(q, mine?.get(q.id) ?? null)
    const row: Cell[] = [
      v.vaqt, v.manager, v.hudud ?? '',
      ...inForm.map(answer),
      ...archived.map(answer),
      v.lat !== null && v.lng !== null ? `${Number(v.lat)}, ${Number(v.lng)}` : '',
      base ? `${base}/vizit/${v.id}` : v.id,
    ]
    // A shop with no region (db/26: no location in the sheet yet, or abroad)
    // has no tab to go in, so its visit lives in the master tab alone rather
    // than being dropped.
    byRegion.get(v.region_code)?.rows.push(row)
    return row
  })

  const regions = [...byRegion.values()]
    .sort((a, b) => a.sort - b.sort)
    .map((r) => ({ title: r.title, rows: [header, ...r.rows] }))

  return { master: [header, ...rows], regions }
}

/** Say the spreadsheet is behind. Cheap, and safe to call from a request. */
export async function markSheetsDirty() {
  try {
    await asSystem((db) => db.execute(sql`
      update sheets_sync set dirty = true, dirty_since = coalesce(dirty_since, now()) where id`))
  } catch { /* a visit must never fail because of bookkeeping */ }
}

export type SyncResult =
  | { ok: true; wrote: Record<string, number> }
  | { ok: false; reason: 'not-configured' | 'busy' | 'paused' | 'failed'; error?: string }

/**
 * Push everything. Takes a lease first so a burst of visits produces one push,
 * not one per visit, and clears `dirty` only on success — anything that fails
 * stays owed and is picked up by the retry loop.
 */
export async function runSheetsSync(): Promise<SyncResult> {
  if (!isConfigured()) return { ok: false, reason: 'not-configured' }

  // Taking the lease and checking the switch is one statement: a push that
  // starts a microsecond before someone pauses would otherwise still run.
  const got = await asSystem(async (db) => {
    const r = await db.execute(sql`
      update sheets_sync set running_until = now() + interval '2 minutes'
       where id and not paused and (running_until is null or running_until < now())
      returning id`)
    if (r.rows.length) return 'go'
    const p = await db.execute(sql`select paused from sheets_sync where id`)
    return (p.rows[0] as { paused: boolean }).paused ? 'paused' : 'busy'
  })
  if (got === 'paused') return { ok: false, reason: 'paused' }
  if (got === 'busy') return { ok: false, reason: 'busy' }

  try {
    const sheet = await asSystem(buildVisitSheet)
    // the master tab keeps its configured name; the region tabs are named after
    // the region, and a name collision between the two simply means one write
    const master = await masterTabTitle()
    const tabs = [
      { title: master, rows: sheet.master },
      ...sheet.regions.filter((r) => r.title !== master),
    ]
    const out = await writeVisitTabs(tabs, VISITS_MARK)
    const wrote = out.wrote
    if (out.skipped.length) {
      console.warn('[sheets] boshqa ma\'lumot bor, yozilmadi:', out.skipped.join(', '))
    }

    await asSystem((db) => db.execute(sql`
      update sheets_sync
         set dirty = false, dirty_since = null, last_ok_at = now(),
             last_error = null, last_error_at = null
       where id`))
    return { ok: true, wrote }
  } catch (e) {
    const msg = e instanceof SheetsNotConfigured ? e.message : (e as Error).message
    await asSystem((db) => db.execute(sql`
      update sheets_sync set last_error = ${msg}, last_error_at = now() where id`))
    return { ok: false, reason: 'failed', error: msg }
  } finally {
    await asSystem((db) => db.execute(sql`update sheets_sync set running_until = null where id`))
  }
}

/**
 * Retry loop for a push that failed — Google was down, the token expired, the
 * laptop was off the wifi. Without it a failed push means a visit that never
 * reaches the spreadsheet and nobody finds out until someone counts rows.
 *
 * Same reason as the Telegram poller: this cannot live in instrumentation.ts,
 * because Next compiles that for the edge runtime too and pg cannot go there.
 */
let looping = false
export function ensureSheetsSyncing() {
  if (looping || !isConfigured()) return
  looping = true
  const tick = async () => {
    try {
      const owed = await asSystem(async (db) => {
        const r = await db.execute(sql`select dirty from sheets_sync where id`)
        return !!(r.rows[0] as { dirty: boolean } | undefined)?.dirty
      })
      if (owed) await runSheetsSync()
    } catch (e) {
      console.error('[sheets] retry failed:', (e as Error).message)
    }
    setTimeout(tick, 30000)
  }
  setTimeout(tick, 5000)
}

/** Fire a push without making the caller wait for Google. */
export function pushSheetsSoon() {
  ensureSheetsSyncing()
  void markSheetsDirty().then(() => runSheetsSync()).catch(() => {})
}

export async function sheetsStatus() {
  return asSystem(async (db) => {
    const r = await db.execute(sql`
      select dirty, dirty_since, last_ok_at, last_error, last_error_at, paused from sheets_sync where id`)
    return r.rows[0] as {
      dirty: boolean; dirty_since: string | null
      last_ok_at: string | null; last_error: string | null; last_error_at: string | null
      paused: boolean
    }
  })
}
