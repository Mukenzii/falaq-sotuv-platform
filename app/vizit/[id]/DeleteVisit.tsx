'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Deleting is rare and irreversible, so it asks first and says exactly what
 * goes. The reason is optional — an admin cleaning up a duplicate at 9pm should
 * not be blocked by a form field — but it is the only thing the audit log
 * cannot reconstruct afterwards, so the box is there and focused.
 */
export default function DeleteVisit({ id, storeId, storeCode, when }: {
  id: string; storeId: string; storeCode: string; when: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const router = useRouter()

  async function remove() {
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(`/api/visits/${id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sabab: reason }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) {
        setErr(j?.error ?? "O'chirib bo'lmadi")
        setBusy(false)
        return
      }
      ref.current?.close()
      // this page no longer has a row behind it; replace so Back does not
      // return to a visit that is gone
      router.replace(`/dokon/${storeId}`)
      router.refresh()
    } catch {
      setErr('Aloqa yo‘q')
      setBusy(false)
    }
  }

  return (
    <>
      <div className="sheetacts" style={{ marginTop: 28 }}>
        <span className="spacer" />
        <button type="button" className="btn btn-danger btn-sm"
                onClick={() => { setErr(null); ref.current?.showModal() }}>
          Vizitni o&apos;chirish
        </button>
      </div>

      <dialog ref={ref} className="plansheet" aria-labelledby="del-title"
              onClick={(e) => { if (e.target === ref.current && !busy) ref.current?.close() }}>
        <h3 id="del-title">Vizitni o&apos;chirish</h3>
        <p className="hint" style={{ marginTop: 0 }}>{storeCode} · {when}</p>

        <p style={{ fontSize: 15 }}>
          Vizit kitoblari, rasmlari va javoblari bilan birga butunlay o&apos;chadi.
          Google Sheets&apos;dagi qatori ham keyingi yangilanishda yo&apos;qoladi.
          Buni orqaga qaytarib bo&apos;lmaydi.
        </p>

        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="del-reason">Sababi</label>
          <textarea id="del-reason" rows={2} value={reason} disabled={busy}
                    placeholder="masalan: ikki marta yuborilgan"
                    onChange={(e) => setReason(e.target.value)} />
        </div>

        {err && <p className="hint err" role="alert">{err}</p>}

        <div className="sheetacts">
          <span className="spacer" />
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                  onClick={() => ref.current?.close()}>
            Bekor qilish
          </button>
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={remove}>
            {busy ? "O'chirilmoqda…" : "Ha, o'chirilsin"}
          </button>
        </div>
      </dialog>
    </>
  )
}
