/** A list of region codes from a request body: [] when absent, null when malformed. */
export function regionList(v: unknown): string[] | null {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || !v.every((c) => typeof c === 'string' && /^\d{2}$/.test(c))) return null
  return [...new Set(v as string[])]
}
