'use client'

import { useRef, useState } from 'react'
import { uploadImage } from '@/lib/shrinkImage'

export type Photo = { object_key: string; content_type: string; bytes: number; preview: string }

const MAX = 6

export default function PhotoPicker({
  photos,
  onChange,
}: {
  photos: Photo[]
  onChange: (next: Photo[]) => void
}) {
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')

  async function add(files: FileList | null) {
    if (!files?.length) return
    setErr('')
    const room = MAX - photos.length
    const chosen = [...files].slice(0, room)
    if (files.length > room) setErr(`Ko'pi bilan ${MAX} ta rasm`)

    setBusy((n) => n + chosen.length)
    const done: Photo[] = []

    for (const file of chosen) {
      try {
        const { objectKey, bytes, contentType } = await uploadImage(file)
        done.push({
          object_key: objectKey,
          content_type: contentType,
          bytes,
          preview: URL.createObjectURL(file),
        })
      } catch (e) {
        setErr((e as Error).message)
      } finally {
        setBusy((n) => n - 1)
      }
    }

    if (done.length) onChange([...photos, ...done])
    // clear both, so picking the same file twice in a row still fires onChange
    if (camera.current) camera.current.value = ''
    if (gallery.current) gallery.current.value = ''
  }

  function remove(key: string) {
    const gone = photos.find((p) => p.object_key === key)
    if (gone) URL.revokeObjectURL(gone.preview)
    onChange(photos.filter((p) => p.object_key !== key))
  }

  return (
    <div>
      <div className="thumbs">
        {photos.map((p) => (
          <div key={p.object_key} className="thumb">
            <img src={p.preview} alt="Javon rasmi" width={78} height={78} />
            <button type="button" className="thumb-x" onClick={() => remove(p.object_key)}
              aria-label="Rasmni o'chirish">×</button>
          </div>
        ))}
        {busy > 0 && <div className="thumb thumb-busy">Yuklanmoqda…</div>}
      </div>

      {/* capture="environment" opens the back camera straight away on a phone;
          the second input deliberately omits it so the picker shows the gallery.
          On a desktop browser capture is ignored and both open a file dialog. */}
      <input
        ref={camera}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        hidden
        onChange={(e) => add(e.target.files)}
      />
      <input
        ref={gallery}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => add(e.target.files)}
      />

      <div className="pickrow">
        <button type="button" className="btn btn-ghost"
          disabled={photos.length >= MAX}
          onClick={() => camera.current?.click()}>
          Rasmga olish
        </button>
        <button type="button" className="btn btn-ghost"
          disabled={photos.length >= MAX}
          onClick={() => gallery.current?.click()}>
          Galereyadan tanlash
        </button>
      </div>

      <p className="hint" aria-live="polite">
        {err ? <span style={{ color: 'var(--red)' }}>{err}</span>
             : photos.length >= MAX
               ? `${MAX} ta rasm to'ldi`
               : `${photos.length} / ${MAX} rasm`}
      </p>
    </div>
  )
}
