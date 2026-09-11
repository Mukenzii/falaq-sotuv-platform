import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireUserId } from '@/lib/session'
import { presignUpload, objectKeyFor, ensureBucket, isConfigured, publicOriginFor } from '@/lib/minio'

const IMAGES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// A "Fayl yuklash" question accepts more than a shelf photo, so the allowlist
// widens for it — but it is still an allowlist, and the extension comes from
// the table rather than from the file name the browser supplied.
const FILES: Record<string, string> = {
  ...IMAGES,
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}

const MAX_IMAGE = 8 * 1024 * 1024
const MAX_FILE = 50 * 1024 * 1024

/**
 * Hands the browser a short-lived PUT link. The key is generated here, never
 * accepted from the client, so nobody can overwrite another visit's photo.
 */
export async function POST(req: Request) {
  await requireUserId()
  if (!isConfigured()) {
    return NextResponse.json({ error: 'MinIO sozlanmagan' }, { status: 503 })
  }

  const { contentType, bytes, kind } = await req.json()
  const asFile = kind === 'file'
  const table = asFile ? FILES : IMAGES
  const ext = table[contentType]
  if (!ext) {
    return NextResponse.json(
      { error: asFile ? 'Bu turdagi fayl qabul qilinmaydi' : 'Faqat JPEG, PNG yoki WebP rasm yuklash mumkin' },
      { status: 400 },
    )
  }
  const max = asFile ? MAX_FILE : MAX_IMAGE
  if (typeof bytes === 'number' && bytes > max) {
    return NextResponse.json({ error: `Fayl ${Math.round(max / 1024 / 1024)} MB dan katta` }, { status: 413 })
  }

  try {
    await ensureBucket()
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }

  const objectKey = objectKeyFor(randomUUID(), 0, ext)
  const origin = publicOriginFor(req.headers.get('host'))
  return NextResponse.json({ objectKey, url: presignUpload(objectKey, origin) })
}
