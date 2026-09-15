/**
 * Territory / store-type filtering, shared by /dokon (server), the plan
 * assigner and the MML page (client). '' means any, NONE means "not set".
 */

export type StoreFacet = { territory: string | null; store_type: string | null }
export type FacetKey = 'hudud' | 'turi'

export const NONE = '-'

const hit = (value: string | null, want: string) => !want || (want === NONE ? !value : value === want)

export function storeMatches(s: StoreFacet, hudud: string, turi: string): boolean {
  return hit(s.territory, hudud) && hit(s.store_type, turi)
}

/** Distinct values with counts; codes sort numerically ("0104" before "30"), unset last. */
export function facet(stores: StoreFacet[], key: keyof StoreFacet): Array<[string | null, number]> {
  const counts = new Map<string | null, number>()
  for (const s of stores) counts.set(s[key], (counts.get(s[key]) ?? 0) + 1)
  return [...counts].sort(([a], [b]) =>
    a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'uz', { numeric: true }))
}
