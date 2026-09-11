import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { currentUserId } from '@/lib/session'
import { LineChart, BarList } from './Charts'

const FACING_LABEL: Record<string, string> = {
  face: 'Hammasi FACE',
  qisman_face: 'Qisman FACE',
  koreshok: 'Faqat koreshok',
  qutida: 'Qutida / ochilmagan',
}

const money = new Intl.NumberFormat('uz-UZ')

export default async function Dashboard() {
  const me = await currentUserId()
  if (!me) redirect('/login')

  // Every query runs under RLS, so a hudud rahbari sees only their own branch.
  const d = await asUser(me, async (db) => {
    const user = (await db.execute(sql`select full_name, role from users where id = ${me}`)).rows[0] as any
    const head = (await db.execute(sql`
      select count(*) visits,
             count(*) filter (where took_order) orders,
             coalesce(sum(cash_collected), 0) cash,
             count(distinct store_id) stores,
             (select count(*) from v_bugungi_reja) due
        from visits where visited_at > now() - interval '90 days'`)).rows[0] as any

    const weekly = (await db.execute(sql`
      select to_char(date_trunc('week', visited_at), 'DD.MM') label, count(*) value
        from visits
       where visited_at > now() - interval '84 days'
       group by date_trunc('week', visited_at)
       order by date_trunc('week', visited_at)`)).rows as any[]

    const managers = (await db.execute(sql`
      select u.full_name label, count(v.id) value,
             count(*) filter (where v.took_order) orders,
             coalesce(sum(v.cash_collected), 0) cash
        from users u join visits v on v.manager_id = u.id
       where v.visited_at > now() - interval '90 days'
       group by u.full_name order by count(v.id) desc`)).rows as any[]

    // best -> worst, so position carries the ordering rather than colour
    const facing = (await db.execute(sql`
      select facing label, count(*) value from visits
       where facing is not null and visited_at > now() - interval '90 days'
       group by facing
       order by array_position(array['face','qisman_face','koreshok','qutida']::text[], facing::text)`)).rows as any[]

    const stale = (await db.execute(sql`
      select b.title label, count(*) value
        from visit_books vb
        join books b on b.id = vb.book_id
        join visits v on v.id = vb.visit_id
       where vb.status = 'stale' and v.visited_at > now() - interval '90 days'
       group by b.title order by count(*) desc limit 8`)).rows as any[]

    return { user, head, weekly, managers, facing, stale }
  })

  if (!d.user) redirect('/login')
  if (d.user.role !== 'direktor' && d.user.role !== 'sotuv_boshligi' && d.user.role !== 'hudud_rahbari') {
    redirect('/')
  }

  const rate = Number(d.head.visits) ? Math.round((Number(d.head.orders) / Number(d.head.visits)) * 100) : 0

  return (
    <main id="main" className="wrap-wide">
      <h1>Hisobot</h1>
      <p className="sub">Oxirgi 90 kun</p>

      <div className="tiles">
        <div className="tile"><b>{money.format(Number(d.head.visits))}</b><span>vizit</span></div>
        <div className="tile"><b>{rate}%</b><span>buyurtma bilan</span></div>
        <div className="tile"><b>{money.format(Number(d.head.cash))}</b><span>yig&apos;ilgan so&apos;m</span></div>
        <div className="tile urgent"><b>{money.format(Number(d.head.due))}</b><span>borish kerak</span></div>
      </div>

      <h2>Haftalik vizitlar</h2>
      <LineChart points={d.weekly.map((r) => ({ label: r.label, value: Number(r.value) }))} unit="vizit" />

      <h2>Menejerlar</h2>
      <BarList rows={d.managers.map((r) => ({ label: r.label, value: Number(r.value) }))} unit="vizit" />

      {/* the second measure lives here rather than on a second y-axis */}
      <div className="tablewrap" style={{ marginTop: 14 }}>
        <table>
          <thead>
            <tr><th>Menejer</th><th>Vizit</th><th>Buyurtma</th><th>Ulush</th><th>Yig&apos;ilgan (so&apos;m)</th></tr>
          </thead>
          <tbody>
            {d.managers.map((m) => (
              <tr key={m.label}>
                <td data-label="Menejer">{m.label}</td>
                <td data-label="Vizit">{money.format(Number(m.value))}</td>
                <td data-label="Buyurtma">{money.format(Number(m.orders))}</td>
                <td data-label="Ulush">{Math.round((Number(m.orders) / Number(m.value)) * 100)}%</td>
                <td data-label="Yig'ilgan">{money.format(Number(m.cash))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Javonda qanday turibdi</h2>
      <BarList
        rows={d.facing.map((r) => ({ label: FACING_LABEL[r.label] ?? r.label, value: Number(r.value) }))}
        unit="vizit"
      />

      <h2>Eng ko&apos;p turib qolgan kitoblar</h2>
      <BarList rows={d.stale.map((r) => ({ label: r.label, value: Number(r.value) }))} unit="marta" />
    </main>
  )
}
