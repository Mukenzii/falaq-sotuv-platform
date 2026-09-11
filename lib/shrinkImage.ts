'use client'

/**
 * Downscale and re-encode before upload. Phone cameras produce 4–8 MB files and
 * these go over mobile data from inside a shop.
 *
 * createImageBitmap can hang forever on a truncated or unsupported file (an HEIC
 * Chrome cannot decode, a half-finished download), so it is raced against a
 * timeout and the original is uploaded rather than leaving a stuck spinner.
 */
export async function shrinkImage(file: File, maxEdge = 1600, quality = 0.82): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await Promise.race([
      createImageBitmap(file),
      new Promise<ImageBitmap>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ])
  } catch {
    return file
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size < 900_000) { bitmap.close(); return file }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality))
}

/** presign -> PUT straight to storage -> return the key the server chose. */
export async function uploadImage(file: File): Promise<{ objectKey: string; bytes: number; contentType: string }> {
  const blob = await shrinkImage(file)
  const contentType = blob.type || 'image/jpeg'

  const p = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentType, bytes: blob.size }),
  })
  if (!p.ok) throw new Error((await p.json()).error ?? "Yuklab bo'lmadi")
  const { url, objectKey } = await p.json()

  const put = await fetch(url, { method: 'PUT', body: blob, headers: { 'content-type': contentType } })
  if (!put.ok) throw new Error(`Saqlanmadi (${put.status})`)

  return { objectKey, bytes: blob.size, contentType }
}

/**
 * The "Fayl yuklash" question takes more than pictures, so this skips the
 * canvas step for anything that is not an image and asks the presigner for the
 * wider allowlist. Same contract otherwise: the server picks the key.
 */
export async function uploadFile(
  file: File,
): Promise<{ objectKey: string; bytes: number; contentType: string; name: string }> {
  const isImage = file.type.startsWith('image/') && file.type !== 'image/heic'
  const blob = isImage ? await shrinkImage(file) : file
  const contentType = blob.type || file.type || 'application/octet-stream'

  const p = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentType, bytes: blob.size, kind: 'file' }),
  })
  if (!p.ok) throw new Error((await p.json()).error ?? "Yuklab bo'lmadi")
  const { url, objectKey } = await p.json()

  const put = await fetch(url, { method: 'PUT', body: blob, headers: { 'content-type': contentType } })
  if (!put.ok) throw new Error(`Saqlanmadi (${put.status})`)

  return { objectKey, bytes: blob.size, contentType, name: file.name }
}
