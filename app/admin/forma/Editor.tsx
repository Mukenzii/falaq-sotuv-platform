'use client'

import { useMemo, useState } from 'react'
import Canvas from './Canvas'
import Responses from './Responses'
import Settings from './Settings'
import { useEditor, type Loaded } from './useEditor'
import { errorsOnly, validateDoc } from '@/lib/form/doc'
import Renderer from '@/app/vizit/yangi/Renderer'
import type { DocIssue } from '@/lib/form/doc'

type Tab = 'savollar' | 'javoblar' | 'sozlamalar'

const SAVE_TEXT: Record<string, string> = {
  idle: '',
  saving: 'Saqlanmoqda…',
  saved: 'Saqlandi',
  error: 'Saqlanmadi',
  conflict: 'To\'qnashuv',
}

export default function Editor({
  draft, publishedVersion,
}: {
  draft: Loaded
  publishedVersion: number | null
}) {
  const ed = useEditor(draft)
  const [tab, setTab] = useState<Tab>('savollar')
  const [preview, setPreview] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishMsg, setPublishMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null)
  const [serverIssues, setServerIssues] = useState<DocIssue[] | null>(null)
  const [live, setLive] = useState(publishedVersion)

  const issues = useMemo(() => validateDoc(ed.doc), [ed.doc])
  const errors = errorsOnly(issues)

  async function publish() {
    setPublishing(true); setPublishMsg(null); setServerIssues(null)
    try {
      // an autosave may still be pending; publishing the previous draft would
      // ship a form the admin never saw
      await ed.flush()
      const r = await fetch('/api/form/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await r.json()
      if (r.status === 422) {
        setServerIssues(body.issues ?? [])
        setPublishMsg({ t: 'err', m: body.error ?? 'Formada xatolar bor' })
        return
      }
      if (!r.ok) { setPublishMsg({ t: 'err', m: body.error ?? 'Nashr qilinmadi' }); return }
      ed.setRev(String(body.draft.rev))
      setLive(body.published)
      setPublishMsg({ t: 'ok', m: `${body.published}-versiya nashr qilindi` })
    } catch (e) {
      setPublishMsg({ t: 'err', m: (e as Error).message })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <main id="main" className="wrap-wide">
      <div className="ehead">
        <div>
          <h1>{ed.doc.title || 'Forma'}</h1>
          <p className="sub">
            Qoralama {draft.version}-versiya
            {live ? ` · nashrda ${live}-versiya` : ' · hali nashr qilinmagan'}
          </p>
        </div>

        <div className="ehead-actions">
          <span className={`savestate ${ed.state}`} aria-live="polite">
            {SAVE_TEXT[ed.state]}
            {ed.state === 'error' && !ed.expired && (
              <button type="button" className="btn btn-sm" onClick={ed.retry}>Qayta urinish</button>
            )}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!ed.canUndo}
            onClick={ed.undo} aria-label="Bekor qilish (Ctrl+Z)" title="Bekor qilish (Ctrl+Z)">↶</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!ed.canRedo}
            onClick={ed.redo} aria-label="Qaytarish (Ctrl+Shift+Z)" title="Qaytarish (Ctrl+Shift+Z)">↷</button>
          <button type="button" className="btn btn-ghost" onClick={() => setPreview(true)}>
            Ko&apos;rish
          </button>
          <button type="button" className="btn" disabled={publishing || errors.length > 0}
            onClick={publish}>
            {publishing ? 'Nashr qilinmoqda…' : 'Nashr qilish'}
          </button>
        </div>
      </div>

      {ed.state === 'error' && (
        // A dead session and a failed request need different advice: retrying
        // a 401 just fails again, and the admin has no idea they were logged out.
        <div className="alert err" role="alert">
          {ed.expired ? (
            <>
              <b>Sessiya tugagan — tizimga qaytadan kiring.</b>{' '}
              O&apos;zgarishlaringiz shu oynada turibdi va yo&apos;qolmadi: kirgandan
              so&apos;ng shu yerga qayting va &ldquo;Qayta urinish&rdquo; ni bosing.{' '}
              <a className="btn btn-sm" href="/login" target="_blank" rel="noopener">Kirish</a>{' '}
              <button type="button" className="btn btn-sm btn-ghost" onClick={ed.retry}>Qayta urinish</button>
            </>
          ) : (
            <>
              {ed.error} — o&apos;zgarishlar shu yerda turibdi, yo&apos;qolmadi.{' '}
              <button type="button" className="btn btn-sm" onClick={ed.retry}>Qayta urinish</button>
            </>
          )}
        </div>
      )}

      {ed.state === 'conflict' && (
        <div className="alert err" role="alert">
          <p>{ed.error}</p>
          <button type="button" className="btn btn-sm" onClick={ed.acceptServer}>
            Ularning nusxasini olish
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={ed.forceMine}>
            Mening o&apos;zgarishimni saqlash
          </button>
        </div>
      )}

      <div aria-live="polite">
        {publishMsg && <div className={`alert ${publishMsg.t}`}>{publishMsg.m}</div>}
      </div>

      {(serverIssues ?? (errors.length ? issues : [])).length > 0 && (
        <ul className="issues">
          {(serverIssues ?? issues).map((i, k) => (
            <li key={k} className={i.level}>{i.message}</li>
          ))}
        </ul>
      )}

      <div className="tabs" role="tablist">
        {(['savollar', 'javoblar', 'sozlamalar'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''}
            onClick={() => setTab(t)}>
            {t === 'savollar' ? 'Savollar' : t === 'javoblar' ? 'Javoblar' : 'Sozlamalar'}
          </button>
        ))}
      </div>

      {tab === 'savollar' && <Canvas doc={ed.doc} apply={ed.apply} issues={issues} />}
      {tab === 'javoblar' && <Responses />}
      {tab === 'sozlamalar' && (
        <Settings doc={ed.doc} apply={ed.apply} version={draft.version} publishedVersion={live} />
      )}

      {preview && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Formani ko'rish">
          <div className="sheet-box">
            <div className="sheet-head">
              <h2>Ko&apos;rish — qoralama</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview(false)}
                aria-label="Yopish">×</button>
            </div>
            <div className="sheet-body">
              <p className="hint">
                Bu menejer ko&apos;radigan ko&apos;rinish, o&apos;sha renderer bilan. Javoblar
                saqlanmaydi.
              </p>
              <h3>{ed.doc.title}</h3>
              {ed.doc.description && <p className="sub">{ed.doc.description}</p>}
              {/* remount on every change so the preview never keeps stale answers
                  from a question that has since been retyped */}
              <Renderer key={JSON.stringify(ed.doc.sections.map((s) => s.id))} doc={ed.doc} mode="preview" />
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
