import './globals.css'
import Link from 'next/link'
import { Hanken_Grotesk } from 'next/font/google'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { currentUserId } from '@/lib/session'
import ThemeToggle, { THEME_INIT } from './ThemeToggle'
import LogoutButton from './LogoutButton'

// Self-hosted at build time: managers open this on Uzbek mobile data, so no
// round trip to Google and no layout shift. latin-ext carries oʻ / gʻ.
// One family throughout. Humanist grotesque, quiet at the small sizes a form
// needs, and latin-ext covers oʻ / gʻ.
const sans = Hanken_Grotesk({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata = {
  title: 'Falaq Sotuv',
  description: "Do'kon vizitlari va sotuv nazorati",
}
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUserId()
  const user = me
    ? await asUser(me, async (db) => {
        const r = await db.execute(sql`select full_name, role from users where id = ${me}`)
        return r.rows[0] as { full_name: string; role: string } | undefined
      })
    : undefined

  return (
    <html lang="uz" className={sans.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body>
        <a href="#main" className="skip">Asosiy qismga o&apos;tish</a>
        {user && (
          <header className="topbar">
            <Link href="/" className="brand" style={{ color: 'inherit' }}>
              Falaq Sotuv
            </Link>
            <span className="spacer" />
            <ThemeToggle />
            <span className="who">{user.full_name.split(' ')[0]}</span>
            <LogoutButton />
          </header>
        )}
        {children}
      </body>
    </html>
  )
}
