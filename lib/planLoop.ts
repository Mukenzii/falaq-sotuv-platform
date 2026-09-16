import { sql } from 'drizzle-orm'
import { asSystem } from '@/lib/db'
import { HORIZON_WEEKS } from '@/lib/plan'

/**
 * Nightly top-up for the repeating plans.
 *
 * A rule writes tasks up to a horizon, so without this the plan quietly runs
 * dry a couple of months after anyone last touched it — the worst kind of
 * failure, because the board looks fine until the week it is empty.
 *
 * Same shape as the Sheets retry loop, and for the same reason it cannot live
 * in instrumentation.ts: Next compiles that for the edge runtime too, and pg
 * cannot go there. So a request arms it and it keeps itself alive after that.
 *
 * The date comes from Postgres, not from Node, because the container is on
 * Asia/Tashkent and "which day is it" must mean the same thing here as it does
 * inside plan_generate().
 */

let looping = false
let lastRun = ''

/** Extend every active rule to the horizon. Adds only — safe at any hour. */
export async function topUpPlans(): Promise<number> {
  return asSystem(async (db) => {
    const r = await db.execute(sql`select plan_generate(${HORIZON_WEEKS}) n`)
    return Number((r.rows[0] as { n: number }).n)
  })
}

export function ensurePlanTopUp() {
  if (looping) return
  looping = true
  const tick = async () => {
    try {
      const today = await asSystem(async (db) => {
        const r = await db.execute(sql`select current_date::text d`)
        return (r.rows[0] as { d: string }).d
      })
      // Once per calendar day. The tick is hourly, so on a server that stays
      // up this fires in the first hour after midnight; on one that was
      // restarted it fires once at startup and then settles into the night.
      // Running twice would cost nothing anyway: plan_generate only adds.
      if (today !== lastRun) {
        const n = await topUpPlans()
        lastRun = today
        if (n) console.log(`[reja] ${n} ta takrorlanuvchi reja yozildi (${today})`)
      }
    } catch (e) {
      console.error('[reja] top-up failed:', (e as Error).message)
    }
    setTimeout(tick, 60 * 60 * 1000)
  }
  setTimeout(tick, 10000)
}
