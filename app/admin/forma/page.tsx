import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { me } from '@/lib/auth'
import Editor from './Editor'
import type { FormDoc } from '@/lib/form/types'

/**
 * The editor is a client component and cannot gate itself, so the draft is
 * loaded here behind the role check. A manager never receives the draft at all,
 * and RLS refuses their writes even if they did.
 */
export default async function FormaPage() {
  const user = await me()
  if (!user) redirect('/login')
  if (!user.isAdmin) redirect('/')

  const data = await asUser(user.id, async (db) => {
    const draft = (await db.execute(sql`
      select id, version, rev::text, updated_at, doc from form_versions where status = 'draft' limit 1`)).rows[0] as
      { id: number; version: number; rev: string; updated_at: string; doc: FormDoc } | undefined
    const published = (await db.execute(sql`
      select version from form_versions where status = 'published' limit 1`)).rows[0] as
      { version: number } | undefined
    return { draft, published }
  })

  if (!data.draft) {
    return (
      <main id="main" className="wrap">
        <h1>Forma</h1>
        <p className="alert err">Qoralama topilmadi — db/10_form_versions.sql yuklanmagan.</p>
      </main>
    )
  }

  return (
    <Editor
      draft={{
        id: data.draft.id,
        version: data.draft.version,
        rev: String(data.draft.rev),
        updated_at: String(data.draft.updated_at),
        doc: data.draft.doc,
      }}
      publishedVersion={data.published?.version ?? null}
    />
  )
}
