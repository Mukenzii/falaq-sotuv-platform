import { notFound, redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { asUser } from '@/lib/db'
import { currentUserId } from '@/lib/session'

const money = new Intl.NumberFormat('uz-UZ')
const day = new Intl.DateTimeFormat('uz-UZ', { day: '2-digit', month: 'long', year: 'numeric' })

export default async function StoreDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUserId()
  if (!me) redirect('/login')
  const { id } = await params

  const d = await asUser(me, async (db) => {
    const s = (await db.execute(sql`
      select s.*, u.full_name owner from stores s
        left join users u on u.id = s.owner_id
       where s.id = ${id}`)).rows[0] as any
    if (!s) return { store: null }

    return {
      store: s,
      stat: (await db.execute(sql`
        select count(*) visits,
               count(*) filter (where took_order) orders,
               coalesce(sum(cash_collected), 0) cash,
               max(visited_at) last_visit,
               round(avg(area_m2), 1) area
          from visits where store_id = ${id}`)).rows[0] as any,
      visits: (await db.execute(sql`
        select v.id, v.visited_at, v.took_order, v.facing, v.debt_status, v.cash_collected,
               u.full_name manager,
               (select count(*) from visit_books b where b.visit_id = v.id and b.status='stale') stale,
               (select count(*) from visit_photos p where p.visit_id = v.id) photos
          from visits v join users u on u.id = v.manager_id
         where v.store_id = ${id} order by v.visited_at desc limit 30`)).rows as any[],
      stale: (await db.execute(sql`
        select b.title, count(*) n from visit_books vb
          join visits v on v.id = vb.visit_id
          join books b on b.id = vb.book_id
         where v.store_id = ${id} and vb.status = 'stale'
         group by 1 order by 2 desc limit 8`)).rows as any[],
    }
  })

  if (!d.store) notFound()
  const s = d.store
  const st = d.stat!
  const overdue = st.last_visit
    ? Math.floor((Date.now() - new Date(st.last_visit).getTime()) / 86400000)
    : null

  return (
    <main id="main" className="wrap">
      <p className="crumb"><Link href="/dokon">Do&apos;konlar</Link></p>
      <h1>{s.name}</h1>
      <p className="sub">{s.code}</p>

      <div className="tiles">
        <div className="tile"><b>{money.format(Number(st.visits))}</b><span>vizit</span></div>
        <div className="tile">
          <b>{Number(st.visits) ? Math.round((Number(st.orders) / Number(st.visits)) * 100) : 0}%</b>
          <span>buyurtma bilan</span>
        </div>
        <div className="tile"><b>{money.format(Number(st.cash))}</b><span>yig&apos;ilgan so&apos;m</span></div>
        <div className={`tile ${overdue == null || overdue >= s.visit_every_days ? 'urgent' : ''}`}>
          <b>{overdue == null ? '—' : overdue}</b><span>kun oldin</span>
        </div>
      </div>

      <h2>Ma&apos;lumot</h2>
      <dl className="detail">
        <div className="drow"><dt>Hudud</dt><dd>{s.region}</dd></div>
        <div className="drow"><dt>Kanal</dt><dd>{s.channel ?? '—'}</dd></div>
        <div className="drow"><dt>Turi</dt><dd>{s.letter_code ?? '—'}</dd></div>
        <div className="drow"><dt>Mas&apos;ul menejer</dt><dd>{s.owner ?? 'biriktirilmagan'}</dd></div>
        <div className="drow"><dt>Borish oralig&apos;i</dt><dd>har {s.visit_every_days} kunda</dd></div>
        <div className="drow"><dt>O&apos;rtacha javon</dt><dd>{st.area ? `${st.area} m²` : '—'}</dd></div>
      </dl>

      {d.stale!.length > 0 && (
        <>
          <h2>Shu do&apos;konda turib qolgan kitoblar</h2>
          <ul className="taglist bad">
            {d.stale!.map((b) => <li key={b.title}>{b.title}<b>{b.n}</b></li>)}
          </ul>
        </>
      )}

      <h2>Vizitlar tarixi</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Sana</th><th>Menejer</th><th>Buyurtma</th><th>Qarz</th><th>Turib qolgan</th><th>Rasm</th></tr>
          </thead>
          <tbody>
            {d.visits!.map((v) => (
              <tr key={v.id}>
                <td data-label="Sana"><Link href={`/vizit/${v.id}`}>{day.format(new Date(v.visited_at))}</Link></td>
                <td data-label="Menejer">{v.manager}</td>
                <td data-label="Buyurtma">{v.took_order ? 'ha' : "yo'q"}</td>
                <td data-label="Qarz">{v.debt_status ?? '—'}</td>
                <td className="num" data-label="Turib qolgan">{v.stale}</td>
                <td className="num" data-label="Rasm">{v.photos}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!d.visits!.length && <div className="empty">Hali vizit yo&apos;q</div>}
      </div>
    </main>
  )
}
