'use client'

import type { FormDoc } from '@/lib/form/types'

type Apply = (next: FormDoc | ((d: FormDoc) => FormDoc), coalesceKey?: string) => void

export default function Settings({
  doc, apply, version, publishedVersion,
}: {
  doc: FormDoc
  apply: Apply
  version: number
  publishedVersion: number | null
}) {
  const set = (patch: Partial<FormDoc>, key?: string) => apply((d) => ({ ...d, ...patch }), key)
  const setting = (patch: Partial<FormDoc['settings']>) =>
    apply((d) => ({ ...d, settings: { ...d.settings, ...patch } }))

  return (
    <div className="settings">
      <div className="field">
        <label htmlFor="ftitle">Forma nomi</label>
        <input id="ftitle" type="text" value={doc.title} onChange={(e) => set({ title: e.target.value }, 'ft')} />
      </div>

      <div className="field">
        <label htmlFor="fdesc">Tavsif</label>
        <textarea id="fdesc" rows={3} value={doc.description}
          onChange={(e) => set({ description: e.target.value }, 'fd')} />
      </div>

      <fieldset className="field">
        <legend className="lbl">Bo&apos;limlar qanday ko&apos;rsatiladi</legend>
        <label className="tick">
          <input type="radio" name="pag" checked={doc.settings.pagination === 'single'}
            onChange={() => setting({ pagination: 'single' })} />
          Bitta sahifada — hamma bo&apos;lim ketma-ket
        </label>
        <label className="tick">
          <input type="radio" name="pag" checked={doc.settings.pagination === 'sections'}
            onChange={() => setting({ pagination: 'sections' })} />
          Har bo&apos;lim alohida sahifa — Keyingi / Orqaga
        </label>
        <p className="hint">
          Alohida sahifada har bo&apos;lim o&apos;tishdan oldin tekshiriladi va javoblar
          saqlanib qoladi. Javobga qarab o&apos;tish faqat shu rejimda ishlaydi.
        </p>
      </fieldset>

      <label className="tick">
        <input type="checkbox" checked={doc.settings.showProgress}
          onChange={(e) => setting({ showProgress: e.target.checked })} />
        Bosqich chizig&apos;ini ko&apos;rsatish
      </label>

      <div className="field">
        <label htmlFor="fconfirm">Yuborilgandan keyingi xabar</label>
        <input id="fconfirm" type="text" value={doc.settings.confirmText}
          onChange={(e) => setting({ confirmText: e.target.value })} />
      </div>

      <h3>Versiya</h3>
      <p className="stat">
        Qoralama <b>{version}</b>-versiya
        {publishedVersion ? <> · nashrda <b>{publishedVersion}</b>-versiya</> : ' · hali nashr qilinmagan'}
      </p>
      <p className="hint">
        Nashr qilinganda joriy versiya arxivga o&apos;tadi, lekin o&apos;chirilmaydi: har bir
        javob o&apos;zi to&apos;ldirilgan versiyani ko&apos;rsatadi, shuning uchun eski javoblar
        savol o&apos;zgargandan keyin ham o&apos;qiladi.
      </p>
    </div>
  )
}
