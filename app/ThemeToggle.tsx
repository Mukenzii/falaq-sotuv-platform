'use client'

import { useEffect, useState } from 'react'

type Theme = 'system' | 'light' | 'dark'
const ORDER: Theme[] = ['system', 'light', 'dark']
const ICON = { system: '◐', light: '☀', dark: '☾' }
const LABEL = { system: 'Tizim', light: 'Yorug‘', dark: 'Qorong‘i' }

export function applyTheme(t: Theme) {
  const root = document.documentElement
  // Kill transitions for one frame: without this every transitioned property
  // animates through a muddy midpoint on switch, and chips read as grey boxes.
  root.classList.add('theme-switching')
  if (t === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
  requestAnimationFrame(() => requestAnimationFrame(() =>
    root.classList.remove('theme-switching')))
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    // localStorage throws in some privacy modes; a missing preference is fine
    try {
      const saved = localStorage.getItem('falaq-theme') as Theme | null
      if (saved && ORDER.includes(saved)) setTheme(saved)
    } catch {}
  }, [])

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
    setTheme(next)
    applyTheme(next)
    try { localStorage.setItem('falaq-theme', next) } catch {}
  }

  return (
    <button className="themebtn" onClick={cycle} title={`Mavzu: ${LABEL[theme]}`} aria-label="Mavzu">
      {ICON[theme]}
    </button>
  )
}

/** Runs before first paint so a saved choice never flashes the wrong theme. */
export const THEME_INIT = `try{var t=localStorage.getItem('falaq-theme');if(t&&t!=='system')document.documentElement.setAttribute('data-theme',t)}catch(e){}`
