'use client'

/** A pressed-state button, used everywhere a choice is made. */
export function Chip({
  on, onClick, children, tone, disabled,
}: {
  on?: boolean
  onClick?: () => void
  children: React.ReactNode
  tone?: string
  disabled?: boolean
}) {
  return (
    <button type="button" aria-pressed={!!on} onClick={onClick} disabled={disabled}
      className={`chip ${on ? 'on' : ''} ${tone ?? ''}`}>
      {children}
    </button>
  )
}
