import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { errorResponse } from '@/lib/form/http'
import { GoogleFormsNotConfigured, fetchGoogleForm, googleImportAvailable, parseFormId } from '@/lib/form/google'

/** Whether the button should be offered at all, and why not when it should not. */
export async function GET() {
  try {
    await requireAdmin()
    return NextResponse.json({
      available: googleImportAvailable(),
      account: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    })
  } catch (e) {
    return errorResponse(e)
  }
}

/**
 * Reads a Google form and hands back blocks ready to insert. Nothing is written
 * here — the admin picks from the preview and the editor inserts into the draft,
 * so an import can never touch the source form or publish anything.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin()
    const { url } = await req.json()
    const formId = parseFormId(String(url ?? ''))
    if (!formId) return NextResponse.json({ error: "Google forma havolasi noto'g'ri" }, { status: 400 })

    const form = await fetchGoogleForm(formId)
    return NextResponse.json(form)
  } catch (e) {
    if (e instanceof GoogleFormsNotConfigured) {
      return NextResponse.json({ error: e.message }, { status: 503 })
    }
    if (e instanceof Error && !(e as any).code) {
      return NextResponse.json({ error: e.message }, { status: 502 })
    }
    return errorResponse(e)
  }
}
