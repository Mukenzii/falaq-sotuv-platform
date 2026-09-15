'use client'

import { facet, storeMatches, NONE, type FacetKey, type StoreFacet } from '@/lib/storeFilter'

/**
 * Hudud + Turi selects. Each count is taken under the OTHER filter, so the
 * numbers in one dropdown always add up to what the list will show.
 */
export function StoreFilters({ stores, hudud, turi, onChange, onClear, idPrefix }: {
  stores: StoreFacet[]
  hudud: string
  turi: string
  onChange: (key: FacetKey, value: string) => void
  onClear: () => void
  idPrefix: string
}) {
  const territories = facet(stores.filter((s) => storeMatches(s, '', turi)), 'territory')
  const types = facet(stores.filter((s) => storeMatches(s, hudud, '')), 'store_type')
  const total = (xs: Array<[string | null, number]>) => xs.reduce((a, [, n]) => a + n, 0)

  return (
    <div className="filters storefilters">
      <label htmlFor={`${idPrefix}-hudud`}>
        <span>Hudud</span>
        <select id={`${idPrefix}-hudud`} value={hudud} onChange={(e) => onChange('hudud', e.target.value)}>
          <option value="">Hamma hudud ({total(territories)})</option>
          {territories.map(([t, n]) => (
            <option key={t ?? NONE} value={t ?? NONE}>{t ?? "Ko'rsatilmagan"} ({n})</option>
          ))}
        </select>
      </label>
      <label htmlFor={`${idPrefix}-turi`}>
        <span>Turi</span>
        <select id={`${idPrefix}-turi`} value={turi} onChange={(e) => onChange('turi', e.target.value)}>
          <option value="">Hamma tur ({total(types)})</option>
          {types.map(([t, n]) => (
            <option key={t ?? NONE} value={t ?? NONE}>{t ?? "Ko'rsatilmagan"} ({n})</option>
          ))}
        </select>
      </label>
      {(hudud || turi) && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>Tozalash</button>
      )}
    </div>
  )
}
