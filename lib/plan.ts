/**
 * The bits of the weekly plan that both /api/plan and /api/plan/rules need.
 * They were private to the first route until rules arrived and started parsing
 * exactly the same dates; two copies of "which Monday is this" is one too many.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date as YYYY-MM-DD, or null. */
export function parseDate(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE.test(value)) return null
  const d = new Date(value + 'T00:00:00Z')
  return !isNaN(+d) && d.toISOString().slice(0, 10) === value ? value : null
}

/** Monday of the week containing the given date, or of this week. */
export function mondayOf(value: string | null): string {
  const d = parseDate(value) ? new Date(value + 'T00:00:00Z') : new Date()
  const day = (d.getUTCDay() + 6) % 7          // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

/** Which day of the week a date falls on, 0 = Monday — the weekday a rule stores. */
export function weekdayOf(day: string): number {
  return (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7
}

/**
 * How often a rule repeats. The counted ones measure from the rule's anchor;
 * juft/toq follow the ISO week number, so every shop on "juft" shares the same
 * weeks. 'oy' is the flexible month: the first such weekday of each month.
 * Kept in step with the check constraint in db/23.
 */
export const CADENCES = [
  'haftada', 'ikki_hafta', 'juft', 'toq', 'uch_hafta', 'tort_hafta', 'oy',
] as const
export type Cadence = (typeof CADENCES)[number]

export const isCadence = (v: unknown): v is Cadence =>
  typeof v === 'string' && (CADENCES as readonly string[]).includes(v)

/** How far ahead a rule is written onto the board. */
export const HORIZON_WEEKS = 8
