import { sql } from 'drizzle-orm'
import { asSystem, type Tx } from '@/lib/db'
import { writeTab, isConfigured, SheetsNotConfigured } from '@/lib/sheets'
import { questionColumns } from '@/lib/form/export'
import { answerText, type AnswerValue } from '@/lib/form/answers'
import type { FormDoc } from '@/lib/form/types'

/**
 * Pushing the whole spreadsheet, as the system, on every change.
 *
 * Two decisions worth not re-litigating:
 *
 * 1. It runs as asSystem, not as the person who triggered it. The spreadsheet
 *    is the company's record, and the trigger is now a manager saving a visit —
 *    an RLS-scoped rewrite would have that manager replace everyone else's rows
 *    with their own dozen. Whoever saves, the sheet gets everything.
 *
 * 2. It rewrites all three tabs rather than appending the one new visit. At a
 *    few visits a day that costs nothing, and it buys exactness: no duplicate
 *    row if a retry overlaps, no drift when an admin adds a form question and
 *    the columns move, and bugungi_reja stays true — the plan changes the
 *    moment a visit lands, which an append would never capture.
 */

function cell(x: unknown): string | number {
  if (x === null || x === undefined) return ''
  if (typeof x === 'boolean') return x ? 'ha' : "yo'q"
  if (typeof x === 'number') return x
  return String(x)
}

function toRows(rows: Record<string, unknown>[], fallback: string[]): (string | number)[][] {
  if (!rows.length) return [fallback]
  return [Object.keys(rows[0]), ...rows.map((r) => Object.values(r).map(cell))]
}

async function collect(db: Tx) {
  const v = await db.execute(sql`
    select v.id, to_char(v.visited_at, 'YYYY-MM-DD HH24:MI') sana, u.full_name manager,
           s.code dokon, s.region hudud, s.channel kanal,
           v.width_m eni, v.height_m boyi, v.area_m2 maydon,
           v.facing, array_to_string(v.placement, ' | ') joylashuv,
           array_to_string(v.shelf_heights, ' | ') javon,
           array_to_string(v.visit_result, ' | ') natija,
           v.took_order buyurtma, v.no_order_reason sabab,
           v.debt_status qarz, v.cash_collected pul,
           (select count(*) from visit_photos p where p.visit_id = v.id) rasmlar,
           v.note izoh
      from visits v
      join users u on u.id = v.manager_id
      join stores s on s.id = v.store_id
     order by v.visited_at desc`)

  const b = await db.execute(sql`
    select to_char(v.visited_at, 'YYYY-MM-DD') sana, u.full_name manager,
           s.code dokon, bk.title kitob, vb.status holat
      from visit_books vb
      join visits v on v.id = vb.visit_id
      join users u on u.id = v.manager_id
      join stores s on s.id = v.store_id
      join books bk on bk.id = vb.book_id
     order by v.visited_at desc, bk.title`)

  // one column per admin-created question, taken from the form document itself
  // so the export follows the form without a code change
  const versions = (await db.execute(sql`
    select version, status, doc from form_versions order by version desc`)).rows as
    Array<{ version: number; status: string; doc: FormDoc }>

  const answers = (await db.execute(sql`
    select va.visit_id, va.block_key, va.value
      from visit_answers va join visits v on v.id = va.visit_id`)).rows as
    Array<{ visit_id: string; block_key: string; value: AnswerValue }>

  const p = await db.execute(sql`
    select code dokon, region hudud, kun_otdi,
           to_char(oxirgi_vizit, 'YYYY-MM-DD') oxirgi_vizit
      from v_bugungi_reja order by kun_otdi desc`)

  const custom = questionColumns(versions, answers.map((a) => a.block_key))
  const byVisit = new Map<string, Map<string, AnswerValue>>()
  for (const a of answers) {
    if (!byVisit.has(a.visit_id)) byVisit.set(a.visit_id, new Map())
    byVisit.get(a.visit_id)!.set(a.block_key, a.value)
  }
  const visitRows = (v.rows as Record<string, unknown>[]).map((row) => {
    const mine = byVisit.get(row.id as string)
    const extra: Record<string, string> = {}
    for (const q of custom) extra[q.title] = answerText(q, mine?.get(q.id) ?? null)
    const { id: _drop, ...rest } = row
    return { ...rest, ...extra }
  })

  return {
    vizitlar: toRows(visitRows, ['sana']),
    vizit_kitoblar: toRows(b.rows as Record<string, unknown>[], ['sana']),
    bugungi_reja: toRows(p.rows as Record<string, unknown>[], ['dokon']),
  }
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
    const tabs = await asSystem(collect)
    const wrote: Record<string, number> = {}
    for (const [title, rows] of Object.entries(tabs)) wrote[title] = await writeTab(title, rows)

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
