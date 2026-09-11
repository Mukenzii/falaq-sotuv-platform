import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { asUser } from '@/lib/db'
import { currentUserId } from '@/lib/session'

const when = new Intl.DateTimeFormat('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })

export default async function Stores() {
  const me = await currentUserId()
  if (!me) redirect('/login')

  const rows = await asUser(me, async (db) => {
    const r = await db.execute(sql`
      select s.id, s.code, s.name, s.region, s.channel, s.visit_every_days,
             u.full_name owner,
             count(v.id) visits,
             max(v.visited_at) last_visit,
             date_part('day', now() - max(v.visited_at))::int kun_otdi
        from stores s
        left join users u on u.id = s.owner_id
        left join visits v on v.store_id = s.id
       where s.active
       group by s.id, u.full_name
       -- most overdue first: the list is a work queue, not an alphabet
       order by (max(v.visited_at) is null) desc, max(v.visited_at) asc`)
    return r.rows as any[]
  })

  const due = rows.filter((r) => r.kun_otdi == null || r.kun_otdi >= r.visit_every_days).length

  return (
    <main id="main" className="wrap-wide">
      <h1>Do&apos;konlar</h1>
      <p className="sub">{rows.length} ta do&apos;kon, {due} tasiga borish vaqti keldi</p>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Kod</th><th>Nomi</th><th>Kanal</th><th>Mas&apos;ul</th>
              <th>Vizit</th><th>Oxirgi</th><th>Kun</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const overdue = s.kun_otdi == null || s.kun_otdi >= s.visit_every_days
              return (
                <tr key={s.id}>
                  <td data-label="Kod"><Link href={`/dokon/${s.id}`}>{s.code}</Link></td>
                  <td data-label="Nomi">{s.name}</td>
                  <td data-label="Kanal">{s.channel ?? '—'}</td>
                  <td data-label="Mas'ul">{s.owner ?? '—'}</td>
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
        {!rows.length && <div className="empty">Do&apos;kon yo&apos;q</div>}
      </div>
    </main>
  )
}
