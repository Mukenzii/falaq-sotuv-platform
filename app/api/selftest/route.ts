import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { errorResponse } from '@/lib/form/http'
import { runSelfTest, selfTestRunning, SelfTestBusy, UnknownRegion } from '@/lib/selfTest'

// filing, a push to Google, a cleanup and a second push
export const maxDuration = 300

/**
 * Run the production self-test (lib/selfTest.ts). Admins only: it creates and
 * deletes rows across the whole system.
 *
 * The visit is filed by calling this same server, so it goes through the real
 * route with the admin's own cookie. Inside the container that is the app's
 * own port, not the public address: no trip out through the proxy and back.
 */
export async function POST(req: Request) {
  try {
    const me = await requireAdmin()
    const { region } = await req.json().catch(() => ({}))
    if (typeof region !== 'string' || !/^\d{2}$/.test(region)) {
      return NextResponse.json({ error: 'viloyat tanlanmagan' }, { status: 400 })
    }
    if (selfTestRunning()) {
      return NextResponse.json({ error: 'Test allaqachon ishlayapti, biroz kuting' }, { status: 409 })
    }
    const origin = process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : new URL(req.url).origin
    const out = await runSelfTest(me.id, region, { origin, cookie: req.headers.get('cookie') ?? '' })
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof UnknownRegion) return NextResponse.json({ error: e.message }, { status: 400 })
    if (e instanceof SelfTestBusy) {
      return NextResponse.json({ error: 'Test allaqachon ishlayapti, biroz kuting' }, { status: 409 })
    }
    // an auth refusal gets its status; anything else is said in words, not a bare 500 page
    try { return errorResponse(e) } catch {
      return NextResponse.json({ error: (e as Error)?.message ?? 'xatolik' }, { status: 500 })
    }
  }
}
