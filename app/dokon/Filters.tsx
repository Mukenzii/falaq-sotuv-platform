'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { StoreFilters } from '@/app/StoreFilters'
import type { FacetKey, StoreFacet } from '@/lib/storeFilter'

// state lives in the URL so a filtered list can be sent to someone
export default function DokonFilters({ stores }: { stores: StoreFacet[] }) {
  const router = useRouter()
  const params = useSearchParams()

  function set(key: FacetKey, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value); else next.delete(key)
    const qs = next.toString()
    router.replace(qs ? `/dokon?${qs}` : '/dokon', { scroll: false })
  }

  return (
    <StoreFilters stores={stores} idPrefix="dokon"
                  hudud={params.get('hudud') ?? ''} turi={params.get('turi') ?? ''}
                  onChange={set} onClear={() => router.replace('/dokon', { scroll: false })} />
  )
}
