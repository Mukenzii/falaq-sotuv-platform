import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { asUser } from '@/lib/db'
import { currentUserId } from '@/lib/session'
import { storeMatches } from '@/lib/storeFilter'
import DokonFilters from './Filters'
import SyncStores from './SyncStores'

const when = new Intl.DateTimeFormat('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })

type Params = { hudud?: string; turi?: string }

export default async function Stores({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await currentUserId()
  if (!me) redirect('/login')
  const q = await searchParams
  const hudud = q.hudud ?? ''
  const turi = q.turi ?? ''

  const { rows, canEdit } = await asUser(me, async (db) => {
    const r = await db.execute(sql`
      select s.id, s.code, s.name, s.territory, s.store_type, s.grade, s.agent, s.visit_every_days,
             g.name viloyat, u.full_name egasi,
             count(v.id) visits,
             max(v.visited_at) last_visit,
             date_part('day', now() - max(v.visited_at))::int kun_otdi
        from stores s
        left join regions g on g.code = s.region_code
        left join users u on u.id = s.owner_id
        left join visits v on v.store_id = s.id
       where s.active
       group by s.id, g.name, u.full_name
       -- most overdue first: the list is a work queue, not an alphabet
       order by (max(v.visited_at) is null) desc, max(v.visited_at) asc, s.code`)
    const admin = await db.execute(sql`select can_manage_users() ok`)
    return { rows: r.rows as any[], canEdit: !!(admin.rows[0] as { ok: boolean }).ok }
  })

  // filtered here, not in SQL, because the dropdown counts need every row anyway
  const shown = rows.filter((s) => storeMatches(s, hudud, turi))
  const due = shown.filter((r) => r.kun_otdi == null || r.kun_otdi >= r.visit_every_days).length
  const facets = rows.map((s) => ({ territory: s.territory, store_type: s.store_type }))

  return (
    <main id="main" className="wrap-wide">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1>Do&apos;konlar</h1>
          <p className="sub">
            {shown.length} ta do&apos;kon{shown.length !== rows.length && ` (jami ${rows.length})`},
            {' '}{due} tasiga borish vaqti keldi
          </p>
        </div>
        {canEdit && <SyncStores />}
      </div>

      <DokonFilters stores={facets} />

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Kod</th><th>Nomi</th><th>Viloyat</th><th>Kim</th><th>Hudud</th><th>Turi</th>
              <th className="txt">Toifa</th><th className="txt">Agent</th>
              <th>Vizit</th><th className="txt">Oxirgi</th><th>Kun</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const overdue = s.kun_otdi == null || s.kun_otdi >= s.visit_every_days
              return (
                <tr key={s.id}>
                  <td data-label="Kod"><Link href={`/dokon/${s.id}`}>{s.code}</Link></td>
                  <td data-label="Nomi">{s.name}</td>
                  {/* no region means no location in the sheet yet, or abroad */}
                  <td data-label="Viloyat" className={s.viloyat ? '' : 'overdue'}>
                    {s.viloyat ?? 'hududsiz'}
                  </td>
                  {/* who files visits for it: no name here means nobody can */}
                  <td data-label="Kim" className={s.egasi ? '' : 'overdue'}>
                    {s.egasi ?? 'biriktirilmagan'}
                  </td>
                  <td data-label="Hudud">{s.territory ?? '—'}</td>
                  <td data-label="Turi">{s.store_type ?? '—'}</td>
                  <td data-label="Toifa">{s.grade ?? '—'}</td>
                  <td data-label="Agent">{s.agent ?? '—'}</td>
                  <td className="num" data-label="Vizit">{s.visits}</td>
                  <td data-label="Oxirgi">{s.last_visit ? when.format(new Date(s.last_visit)) : '—'}</td>
                  <td data-label="Kun" className={`num ${overdue ? 'overdue' : ''}`}>
                    {s.kun_otdi == null ? 'hech qachon' : s.kun_otdi}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!shown.length && (
          <div className="empty">{rows.length ? "Bu filtrga mos do'kon yo'q" : "Do'kon yo'q"}</div>
        )}
      </div>
    </main>
  )
}
