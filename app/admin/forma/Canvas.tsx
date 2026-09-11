'use client'

import { useEffect, useRef, useState } from 'react'
import BlockEditor from './BlockEditor'
import Toolbar, { type ToolbarAction } from './Toolbar'
import ImportPanel from './ImportPanel'
import { uploadImage } from '@/lib/shrinkImage'
import {
  blankImage, blankQuestion, blankText, blankVideo,
  duplicateBlock, duplicateSection, insertBlock, insertSection, locate,
  moveBlockTo, moveSection, nudgeBlock, removeBlock, removeSection,
  replaceBlock, sectionIndex, updateSection, validateDoc,
} from '@/lib/form/doc'
import type { DocIssue as Issue } from '@/lib/form/doc'
import type { Block, FormDoc } from '@/lib/form/types'

type Apply = (next: FormDoc | ((d: FormDoc) => FormDoc), coalesceKey?: string) => void

export default function Canvas({
  doc, apply, issues,
}: {
  doc: FormDoc
  apply: Apply
  issues: Issue[]
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ sectionId: string; index: number } | null>(null)
  const [importing, setImporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const issueFor = (id: string) => issues.filter((i) => i.where === id)

  /** Insert, then take the admin there: scrolled into view, selected, caret in the title. */
  function focusNew(id: string) {
    setSelected(id)
    requestAnimationFrame(() => {
      const card = document.getElementById(`card-${id}`)
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const title = document.querySelector<HTMLInputElement>(`[data-title-for="${id}"]`)
        ?? card?.querySelector<HTMLInputElement>('input, textarea')
      title?.focus()
    })
  }

  function insert(block: Block) {
    apply((d) => insertBlock(d, block, selected))
    focusNew(block.id)
  }

  async function onToolbar(a: ToolbarAction) {
    setNote(null)
    switch (a) {
      case 'question':
        // a sensible default the admin changes in one click, rather than a
        // "choose a type" step before there is anything to type into
        insert(blankQuestion('multiple_choice'))
        break
      case 'title':
        insert(blankText())
        break
      case 'video':
        insert(blankVideo())
        break
      case 'image':
        imageInput.current?.click()
        break
      case 'section': {
        let id = ''
        apply((d) => { const r = insertSection(d, selected); id = r.id; return r.doc })
        requestAnimationFrame(() => {
          setSelected(id)
          document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          document.querySelector<HTMLInputElement>(`[data-section-title="${id}"]`)?.focus()
        })
        break
      }
      case 'import':
        setImporting(true)
        break
    }
  }

  async function onImagePicked(file: File | undefined) {
    if (!file) return
    setUploading(true); setNote(null)
    try {
      const { objectKey } = await uploadImage(file)
      insert(blankImage(objectKey))
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setUploading(false)
      if (imageInput.current) imageInput.current.value = ''
    }
  }

  /** Import drops the chosen blocks at the same place the toolbar would insert. */
  function onImported(blocks: Block[]) {
    setImporting(false)
    if (!blocks.length) return
    apply((d) => {
      let next = d
      let after = selected
      for (const b of blocks) {
        next = insertBlock(next, b, after)
        after = b.id
      }
      return next
    })
    setNote(`${blocks.length} ta savol qo'shildi`)
    focusNew(blocks[0].id)
  }

  function onDrop(sectionId: string, index: number) {
    if (!dragging) return
    apply((d) => moveBlockTo(d, dragging, sectionId, index))
    setDropAt(null)
    setDragging(null)
  }

  // dragging leaves the pointer somewhere unrelated when it ends
  useEffect(() => {
    const stop = () => { setDragging(null); setDropAt(null) }
    window.addEventListener('dragend', stop)
    return () => window.removeEventListener('dragend', stop)
  }, [])

  const dropline = (sectionId: string, index: number) =>
    dragging ? (
      <div
        className={`dropline ${dropAt?.sectionId === sectionId && dropAt?.index === index ? 'on' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDropAt({ sectionId, index }) }}
        onDrop={(e) => { e.preventDefault(); onDrop(sectionId, index) }}
        aria-hidden="true"
      />
    ) : null

  return (
    <div className="canvas">
      <div aria-live="polite">{note && <div className="alert ok">{note}</div>}</div>

      {doc.sections.map((s, si) => (
        <section key={s.id} id={`section-${s.id}`}
          className={`fsection ${selected === s.id ? 'sel' : ''}`}>
          <header className="fsection-head"
            tabIndex={0} onFocus={() => setSelected(s.id)} onClick={() => setSelected(s.id)}
            id={`card-${s.id}`}>
            <p className="fsection-count">{si + 1} / {doc.sections.length}-bo&apos;lim</p>
            <input className="fsection-title" placeholder="Bo'lim nomi" aria-label="Bo'lim nomi"
              data-section-title={s.id} value={s.title}
              onChange={(e) => apply((d) => updateSection(d, s.id, { title: e.target.value }), `st-${s.id}`)} />
            <textarea className="fsection-desc" rows={2} placeholder="Bo'lim tavsifi"
              aria-label="Bo'lim tavsifi" value={s.description ?? ''}
              onChange={(e) => apply((d) => updateSection(d, s.id, { description: e.target.value }), `sd-${s.id}`)} />

            <div className="fsection-actions">
              <label className="fsection-next">
                Bo&apos;limdan keyin
                <select value={s.next.type === 'goto' ? s.next.sectionId : s.next.type}
                  onChange={(e) => {
                    const v = e.target.value
                    apply((d) => updateSection(d, s.id, {
                      next: v === 'continue' ? { type: 'continue' }
                        : v === 'submit' ? { type: 'submit' }
                        : { type: 'goto', sectionId: v },
                    }))
                  }}>
                  <option value="continue">keyingi bo&apos;limga</option>
                  {doc.sections.filter((x) => x.id !== s.id).map((x, i) => (
                    <option key={x.id} value={x.id}>
                      {doc.sections.indexOf(x) + 1}. {x.title || 'nomsiz'} ga o&apos;tish
                    </option>
                  ))}
                  <option value="submit">formani yuborish</option>
                </select>
              </label>

              <span className="spacer" />
              <button type="button" className="btn btn-ghost btn-sm" disabled={si === 0}
                aria-label="Bo'limni yuqoriga" onClick={() => apply((d) => moveSection(d, s.id, -1))}>↑</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={si === doc.sections.length - 1}
                aria-label="Bo'limni pastga" onClick={() => apply((d) => moveSection(d, s.id, 1))}>↓</button>
              <button type="button" className="btn btn-ghost btn-sm" aria-label="Bo'limdan nusxa olish"
                onClick={() => apply((d) => duplicateSection(d, s.id)?.doc ?? d)}>⧉</button>
              <button type="button" className="btn btn-ghost btn-sm danger"
                disabled={doc.sections.length <= 1} aria-label="Bo'limni o'chirish"
                onClick={() => setConfirmDelete(s.id)}>🗑</button>
            </div>

            {issueFor(s.id).map((i, k) => (
              <p key={k} className={i.level === 'error' ? 'fielderr' : 'hint'}>{i.message}</p>
            ))}

            {/* deleting a section is two different intentions; it has to ask */}
            {confirmDelete === s.id && (
              <div className="alert err" role="alertdialog" aria-label="Bo'limni o'chirish">
                <p>&quot;{s.title || `${si + 1}-bo'lim`}&quot; ichida {s.blocks.length} ta blok bor.</p>
                <button type="button" className="btn btn-sm" onClick={() => {
                  apply((d) => removeSection(d, s.id, true)); setConfirmDelete(null)
                }}>Bloklarni saqlab qolish</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => {
                  apply((d) => removeSection(d, s.id, false)); setConfirmDelete(null)
                }}>Hammasini o&apos;chirish</button>
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => setConfirmDelete(null)}>Bekor qilish</button>
              </div>
            )}
          </header>

          <div className="fsection-body">
            {dropline(s.id, 0)}
            {s.blocks.map((b, bi) => (
              <div key={b.id}>
                <div className={dragging === b.id ? 'dragging' : ''}>
                  <BlockEditor
                    block={b}
                    selected={selected === b.id}
                    sections={doc.sections}
                    index={bi}
                    count={s.blocks.length}
                    canUp={si > 0 || bi > 0}
                    canDown={si < doc.sections.length - 1 || bi < s.blocks.length - 1}
                    onSelect={() => setSelected(b.id)}
                    onChange={(next, key) => apply((d) => replaceBlock(d, b.id, next), key)}
                    onDuplicate={() => apply((d) => {
                      const r = duplicateBlock(d, b.id)
                      if (r) requestAnimationFrame(() => focusNew(r.id))
                      return r?.doc ?? d
                    })}
                    onDelete={() => { apply((d) => removeBlock(d, b.id)); setSelected(null) }}
                    onMove={(dir) => apply((d) => nudgeBlock(d, b.id, dir))}
                    onDragStart={() => setDragging(b.id)}
                    onDragEnd={() => { setDragging(null); setDropAt(null) }}
                  />
                  {issueFor(b.id).map((i, k) => (
                    <p key={k} className={i.level === 'error' ? 'fielderr' : 'hint'}>{i.message}</p>
                  ))}
                </div>
                {dropline(s.id, bi + 1)}
              </div>
            ))}
            {!s.blocks.length && (
              <p className="empty">Bo&apos;sh bo&apos;lim — o&apos;ng tomondagi tugmalar bilan savol qo&apos;shing.</p>
            )}
          </div>
        </section>
      ))}

      <Toolbar anchorId={selected} onAction={onToolbar} disabled={uploading} />

      <input ref={imageInput} type="file" hidden accept="image/jpeg,image/png,image/webp"
        onChange={(e) => onImagePicked(e.target.files?.[0])} />

      {importing && <ImportPanel onClose={() => setImporting(false)} onInsert={onImported} />}
    </div>
  )
}
