'use client'

import { useEffect, useRef, useState } from 'react'

export type ToolbarAction = 'question' | 'import' | 'title' | 'image' | 'video' | 'section'

const ACTIONS: Array<{ id: ToolbarAction; label: string; icon: React.ReactNode }> = [
  { id: 'question', label: "Savol qo'shish", icon: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" /></svg>) },
  { id: 'import', label: 'Savollarni import qilish', icon: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10m0 0-3.5-3.5M12 13l3.5-3.5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>) },
  { id: 'title', label: 'Sarlavha va tavsif', icon: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 11h10M4 16h13M4 20h7" /></svg>) },
  { id: 'image', label: "Rasm qo'shish", icon: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" /><path d="m5 17 4.5-4.5L13 16l2.5-2.5L20 18" /></svg>) },
  { id: 'video', label: "Video qo'shish", icon: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m10 9.5 5 2.5-5 2.5z" /></svg>) },
  { id: 'section', label: "Bo'lim qo'shish", icon: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16" />
      <path d="M9 12h6" strokeDasharray="2 2" /></svg>) },
]

const NARROW = 980
const GAP = 12

/**
 * The floating toolbar. It sits immediately to the right of whichever card is
 * selected and follows it, which is what makes "add a question here" mean
 * anything: the insertion point is visible rather than remembered.
 *
 * Selection is driven by click and by focus, never by hover — otherwise moving
 * the pointer towards a button would retarget the insert the moment it crossed
 * another card, and on a touchscreen there is no hover to depend on at all.
 */
export default function Toolbar({
  anchorId, onAction, disabled,
}: {
  anchorId: string | null
  onAction: (a: ToolbarAction) => void
  disabled?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const measure = () => {
      const compact = window.innerWidth < NARROW
      setNarrow(compact)
      if (compact) { setPos(null); return }

      const el = anchorId ? document.getElementById(`card-${anchorId}`) : null
      if (!el) { setPos(null); return }
      const r = el.getBoundingClientRect()
      const h = box.current?.offsetHeight ?? 250
      const w = box.current?.offsetWidth ?? 48

      // Kept inside the viewport, but never pulled over the card it belongs to:
      // it is clamped against the window and then pushed to the card's right.
      const top = Math.min(Math.max(r.top, 12), window.innerHeight - h - 12)
      let left = r.right + GAP
      if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - GAP)
      setPos({ top, left })
    }

    measure()
    const onScroll = () => requestAnimationFrame(measure)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    window.addEventListener('resize', measure)

    let ro: ResizeObserver | undefined
    const el = anchorId ? document.getElementById(`card-${anchorId}`) : null
    if (el && 'ResizeObserver' in window) {
      ro = new ResizeObserver(measure)
      ro.observe(el)
    }
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true } as any)
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [anchorId])

  // arrow keys walk the toolbar, so it is one stop in the tab order rather than six
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys = narrow ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    if (!keys.includes(e.key)) return
    e.preventDefault()
    const items = [...(box.current?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = e.key === keys[1] ? 1 : -1
    items[(i + step + items.length) % items.length]?.focus()
  }

  const buttons = ACTIONS.map((a) => (
    <button key={a.id} type="button" className="tbtn" disabled={disabled}
      aria-label={a.label} title={a.label}
      // keeps the selected card selected: without this the pointer-down inside
      // the toolbar blurs the card and the insertion target moves
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onAction(a.id)}>
      {a.icon}
      <span className="tbtn-text">{a.label}</span>
    </button>
  ))

  if (narrow) {
    return (
      <div ref={box} className="toolbar toolbar-bottom" role="toolbar"
        aria-label="Formaga qo'shish" onKeyDown={onKeyDown}>
        {buttons}
      </div>
    )
  }

  return (
    <div ref={box} className="toolbar toolbar-side" role="toolbar"
      aria-label="Formaga qo'shish" onKeyDown={onKeyDown}
      style={pos ? { top: pos.top, left: pos.left } : { top: 96, right: 16 }}>
      {buttons}
    </div>
  )
}
