import { useCallback, useEffect, useRef, useState } from 'react'

type Phase = 'idle' | 'starting' | 'waiting' | 'error'

/**
 * The same flow as app/login/Client.tsx. Kept in step by hand for now — the
 * two builds do not share a module yet, and this is the second thing to have
 * been duplicated after globals.css.
 */
const clearClientCache = () => {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('falaq.cache.')) localStorage.removeItem(k)
  } catch { /* private mode or blocked storage: nothing to clear */ }
}

export default function Login() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [link, setLink] = useState('')
  const [err, setErr] = useState('')
  const nonce = useRef<string | null>(null)
  const until = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  useEffect(() => stop, [])

  /** One poll. Returns true when the loop is finished with, either way. */
  const check = useCallback(async (): Promise<boolean> => {
    const n = nonce.current
    if (!n) return true
    if (Date.now() > until.current) {
      setPhase('error'); setErr('Havola eskirdi. Qaytadan urinib ko‘ring.')
      return true
    }
    try {
      const r = await fetch(`/api/auth/tg/poll?nonce=${n}`, { cache: 'no-store' })
      const j = await r.json()
      if (j.state === 'ok') {
        clearClientCache()          // a different person may be signing in here
        // home is the Next app, so this has to be a real page load
        location.replace('/')
        return true
      }
      if (j.state === 'pending') return false
      setPhase('error')
      setErr(j.error ?? 'Kirish amalga oshmadi. Qaytadan urinib ko‘ring.')
      return true
    } catch {
      return false                  // a dropped poll on a phone network is not a failure
    }
  }, [])

  const loop = useCallback(async () => {
    stop()
    if (await check()) return
    timer.current = setTimeout(loop, 2000)
  }, [check])

  /**
   * Coming back from Telegram is the moment the answer is ready, so poll on
   * the spot instead of waiting out the current two-second tick. Browsers also
   * throttle timers in a hidden tab, which would otherwise make the wait after
   * returning feel much longer than it is.
   */
  useEffect(() => {
    if (phase !== 'waiting') return
    const wake = () => { if (document.visibilityState === 'visible') loop() }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [phase, loop])

  async function start() {
    setErr(''); setPhase('starting')
    try {
      const r = await fetch('/api/auth/tg/start', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) { setPhase('error'); setErr(j.error ?? 'Telegram sozlanmagan.'); return }

      nonce.current = j.nonce
      until.current = Date.now() + 9 * 60 * 1000
      setLink(j.url)
      setPhase('waiting')

      // Hand the link to the installed Telegram app. tg:// is taken over by the
      // OS, so this tab does not navigate and does not spawn another one — the
      // login page stays in front, polling, and is already signed in by the
      // time you switch back from Telegram.
      if (j.deeplink) location.href = j.deeplink
      loop()
    } catch {
      setPhase('error'); setErr('Ulanib bo‘lmadi. Internetni tekshiring.')
    }
  }

  return (
    <main className="login">
      <div className="card">
        <h1>Falaq Sotuv</h1>
        <p className="sub" style={{ marginBottom: 24 }}>Telegram orqali kiring</p>

        {phase === 'waiting' ? (
          <>
            <div className="alert ok" style={{ textAlign: 'left', marginBottom: 16 }}>
              Telegramda <b>START</b> ni bosing va shu oynaga qayting — sahifa
              o&apos;zi ochiladi, boshqa hech narsa qilish shart emas.
            </div>
            <div className="spin" aria-live="polite">Kutilmoqda…</div>
            <p className="hint" style={{ marginTop: 16 }}>
              Telegram ochilmadimi?{' '}
              <a href={link} target="_blank" rel="noopener noreferrer">Brauzerda oching</a>
              {' '}— keyin shu oynaga qayting.
            </p>
          </>
        ) : (
          <button className="btn" style={{ width: '100%' }} onClick={start}
                  disabled={phase === 'starting'}>
            {phase === 'starting' ? 'Ochilmoqda…' : 'Telegram orqali kirish'}
          </button>
        )}

        {err && <div className="alert err" style={{ marginTop: 16, marginBottom: 0 }}>{err}</div>}

        {phase !== 'waiting' && (
          <p className="hint" style={{ marginTop: 14 }}>
            Botga <b>START</b> bosasiz, tamom. Ro&apos;yxatda bo&apos;lmagan hisob kira olmaydi.
          </p>
        )}
      </div>
    </main>
  )
}
