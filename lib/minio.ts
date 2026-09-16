import { createHash, createHmac } from 'node:crypto'

/**
 * Minimal S3 (SigV4) presigner for MinIO. Phones PUT straight to storage, so
 * photo bytes never pass through the Next server — which matters on mobile data.
 * No AWS SDK: the signature is ~40 lines of node:crypto.
 */

const REGION = 'us-east-1'
const SERVICE = 's3'
const ALGO = 'AWS4-HMAC-SHA256'

function config() {
  const endpoint = process.env.MINIO_ENDPOINT
  const key = process.env.MINIO_ACCESS_KEY
  const secret = process.env.MINIO_SECRET_KEY
  const bucket = process.env.MINIO_BUCKET
  if (!endpoint || !key || !secret || !bucket) {
    throw new Error('MinIO sozlanmagan: .env da MINIO_* qiymatlari yo\'q')
  }
  // Browsers upload to the public endpoint; the server may reach MinIO elsewhere.
  const publicEndpoint = process.env.MINIO_PUBLIC_ENDPOINT || endpoint
  return { endpoint, publicEndpoint, key, secret, bucket }
}

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex')
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest()

/** Each path segment is encoded, but the slashes between them are not. */
function encodeKey(objectKey: string): string {
  return objectKey.split('/').map((p) => encodeURIComponent(p)).join('/')
}

function signingKey(secret: string, date: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), REGION), SERVICE), 'aws4_request')
}

/** `path` is the already-encoded canonical URI, e.g. /bucket or /bucket/a/b.jpg */
function presignPath(
  method: 'PUT' | 'GET' | 'HEAD' | 'DELETE',
  path: string,
  expiresSeconds: number,
  useInternal = false,
  originOverride?: string,
): string {
  const { endpoint, publicEndpoint, key, secret } = config()
  const url = new URL(useInternal ? endpoint : originOverride || publicEndpoint)

  const now = new Date()
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const date = amzDate.slice(0, 8)
  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`
  const host = url.host
  const canonicalUri = path

  const query: Record<string, string> = {
    'X-Amz-Algorithm': ALGO,
    'X-Amz-Credential': `${key}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&')

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [ALGO, amzDate, scope, sha256hex(canonicalRequest)].join('\n')
  const signature = createHmac('sha256', signingKey(secret, date)).update(stringToSign).digest('hex')

  return `${url.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

function objectPath(objectKey: string) {
  return `/${config().bucket}/${encodeKey(objectKey)}`
}

/**
 * The signature covers the host, so the link must be signed for the address the
 * *browser* will use. A phone on the wifi resolves "localhost" to itself, so the
 * caller passes the host the request actually arrived on.
 */
export function publicOriginFor(host: string | null): string | undefined {
  if (process.env.MINIO_PUBLIC_ENDPOINT) return process.env.MINIO_PUBLIC_ENDPOINT
  const name = host?.split(':')[0]
  if (!name) return undefined
  const port = new URL(process.env.MINIO_ENDPOINT!).port || '9000'
  return `http://${name}:${port}`
}

/** Upload link for the browser. 10 minutes is plenty for one photo. */
export function presignUpload(objectKey: string, publicOrigin?: string) {
  return presignPath('PUT', objectPath(objectKey), 600, false, publicOrigin)
}

/** Read link, short-lived so it cannot be forwarded usefully. */
export function presignView(objectKey: string, publicOrigin?: string) {
  return presignPath('GET', objectPath(objectKey), 300, false, publicOrigin)
}

/** Creates the bucket on first use so a fresh MinIO just works. */
let bucketReady = false

export async function ensureBucket(): Promise<void> {
  if (bucketReady) return
  const { bucket } = config()
  const path = `/${bucket}`

  const head = await fetch(presignPath('HEAD', path, 60, true), { method: 'HEAD' }).catch(() => null)
  if (head?.ok) { bucketReady = true; return }

  const res = await fetch(presignPath('PUT', path, 60, true), { method: 'PUT' })
  // 409 BucketAlreadyOwnedByYou is success for our purposes
  if (!res.ok && res.status !== 409) {
    throw new Error(`bucket yaratilmadi: ${res.status} ${await res.text()}`)
  }
  bucketReady = true
}

export function objectKeyFor(visitDraftId: string, index: number, ext: string) {
  const d = new Date()
  const stamp = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`
  return `${stamp}/${visitDraftId}/${index}.${ext}`
}

export function isConfigured(): boolean {
  try { config(); return true } catch { return false }
}

/**
 * Remove objects for good, used when an admin deletes a visit. The database
 * rows go inside the transaction; the files go after it commits, because an
 * orphaned file costs disk and an orphaned row costs a broken page.
 *
 * Best effort on purpose: a photo that is already gone, or a MinIO that is
 * briefly down, must not undo a delete the admin was told had happened. The
 * internal endpoint is used — no browser is involved, so nothing here needs to
 * be signed for the address a phone would use.
 */
export async function deleteObjects(objectKeys: string[]): Promise<number> {
  if (!isConfigured() || !objectKeys.length) return 0
  let gone = 0
  for (const key of objectKeys) {
    try {
      const url = presignPath('DELETE', objectPath(key), 60, true)
      const r = await fetch(url, { method: 'DELETE' })
      // S3 answers 204 both for a key it removed and for one that was never
      // there, and 404 is the same outcome from our side: the file is not there
      if (r.ok || r.status === 404) gone++
      else console.error('[minio] delete failed:', key, r.status)
    } catch (e) {
      console.error('[minio] delete failed:', key, (e as Error).message)
    }
  }
  return gone
}
