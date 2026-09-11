import { NextResponse } from 'next/server'
import { Forbidden, Unauthorized } from '@/lib/auth'
import { pgCode } from '@/lib/db'

/** One place that turns a thrown guard or an RLS refusal into a status code. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof Unauthorized) return NextResponse.json({ error: 'kirish kerak' }, { status: 401 })
  if (e instanceof Forbidden) return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
  if (pgCode(e) === '42501') return NextResponse.json({ error: "ruxsat yo'q" }, { status: 403 })
  if ((e as Error)?.message === 'unauthorized') {
    return NextResponse.json({ error: 'kirish kerak' }, { status: 401 })
  }
  throw e
}
