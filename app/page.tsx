import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { currentUserId } from '@/lib/session'
import Link from 'next/link'

type Summary = {
  reja: string; vaqtida: string; kechikdi: string; qoldi: string; borilmadi: string; foiz: string | null
}
const OYLAR = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']
const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`

/** One row of "Mening rejam": the plan's columns (as on /admin/reja) for one period. */
function PeriodRow({ label, sub, s }: { label: string; sub: string; s: Summary | undefined }) {
  return (
    <tr>
      <td data-label="Davr">{label}<br /><span className="hint">{sub}</span></td>
      <td data-label="Reja">{s?.reja ?? 0}</td>
      <td data-label="Vaqtida">{s?.vaqtida ?? 0}</td>
      <td data-label="Kechikib">{s?.kechikdi ?? 0}</td>
      <td data-label="Qoldi"><b>{s?.qoldi ?? 0}</b></td>
      <td data-label="Borilmadi">{s?.borilmadi ?? 0}</td>
      <td data-label="%">{s?.foiz == null ? '—' : `${s.foiz}%`}</td>
    </tr>
  )
}

export default async function Home() {
  const me = await currentUserId()
  if (!me) redirect('/login')

  const data = await asUser(me, async (db) => {
    const u = await db.execute(sql`select full_name, role from users where id = ${me}`)
    // "borish kerak" is what the PLAN owes this person, not every overdue shop
    // in the system: v_bugungi_reja is the territory-era view and reads the
    // same for everyone, which made the headline a number nobody could act on.
    const s = await db.execute(sql`
      select
        (select count(*) from v_week_plan p
          where p.user_id = current_user_id()
            and p.week_start <= week_of() and not p.bajarildi)                    as kerak,
        (select count(*) from v_week_plan p
          where p.user_id = current_user_id() and p.week_start = week_of())       as reja,
        (select count(*) from v_week_plan p
          where p.user_id = current_user_id()
            and p.week_start = week_of() and p.bajarildi)                         as bajarildi,
        (select count(*) from visits where visited_at::date = current_date)       as today,
        (select count(*) from visits where visited_at > now() - interval '7 days')as week`)
    // this person's own plan, this week and this calendar month (db/34) —
    // the same columns the board's Xodimlar table shows
    const p = (await db.execute(sql`
      select week_of()::text as hafta, date_trunc('month', current_date)::date::text as oy`)).rows[0] as
      { hafta: string; oy: string }
    const weekly = (await db.execute(sql`
      select reja, vaqtida, kechikdi, qoldi, borilmadi, foiz from v_week_summary
       where week_start = week_of() and user_id = current_user_id()`)).rows[0] as Summary | undefined
    const monthly = (await db.execute(sql`
      select reja, vaqtida, kechikdi, qoldi, borilmadi, foiz from month_summary(current_date)
       where user_id = current_user_id()`)).rows[0] as Summary | undefined
    return {
      user: u.rows[0] as { full_name: string; role: string } | undefined,
      stat: s.rows[0] as any,
      plan: { ...p, weekly, monthly },
    }
  })

  if (!data.user) redirect('/login')
  const isAdmin = data.user.role === 'direktor' || data.user.role === 'sotuv_boshligi'
  const { kerak, reja, bajarildi, today, week } = data.stat
  const agent = data.user.role === 'sotuv_manager'
  const { plan } = data
  const sunday = new Date(Date.parse(plan.hafta + 'T00:00:00Z') + 6 * 864e5).toISOString().slice(0, 10)

  return (
    <main id="main" className="wrap">
      {/* Lead with the one thing worth acting on, said as a sentence rather than a tile. */}
      <p className="headline">
        {Number(kerak) > 0
          ? <><em>{kerak} ta</em> do&apos;konga borish kerak.</>
          : Number(reja) > 0
            ? <>Bu haftaning hammasiga borilgan.</>
            : <>Sizga do&apos;kon biriktirilmagan.</>}
      </p>
      <p className="standfirst">
        {/* the plan first, because that is what the headline counts; the visit
            tally second, because it is the thing they can already see happening */}
        {Number(reja) > 0
          ? `Bu hafta ${reja} ta do'kon biriktirilgan, ${bajarildi} tasiga borildi. `
          : ''}
        {Number(today) > 0
          ? `Bugun ${today} ta vizit yozdingiz. Bu haftada ${week} ta.`
          : `Bugun hali vizit yo'q. Bu haftada ${week} ta.`}
      </p>

      <Link href="/vizit/yangi" className="btn">Yangi vizit</Link>

      {/* an agent's own week and month — or anyone's who has plan tasks */}
      {(agent || plan.weekly || plan.monthly) && (
        <>
          <h2>Mening rejam</h2>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th>Davr</th><th>Reja</th><th>Vaqtida</th><th>Kechikib</th>
                <th>Qoldi</th><th>Borilmadi</th><th>%</th>
              </tr></thead>
              <tbody>
                <PeriodRow label="Haftalik" sub={`${ddmm(plan.hafta)} — ${ddmm(sunday)}`} s={plan.weekly} />
                <PeriodRow label="Oylik" sub={`${OYLAR[Number(plan.oy.slice(5, 7)) - 1]} ${plan.oy.slice(0, 4)}`}
                           s={plan.monthly} />
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Ko&apos;rish</h2>
      <Link href="/dokon" className="navcard">
        <b>Do&apos;konlar</b>
        <small>Har bir do&apos;kon va uning tarixi</small>
      </Link>

      {/* an agent's own board: their shops, Monday to Sunday, read-only */}
      {agent && (
        <Link href="/admin/reja" className="navcard">
          <b>Haftalik reja</b>
          <small>Mening doskam: qaysi kuni qaysi do&apos;konga borish kerak</small>
        </Link>
      )}

      {/* a head plans the week for their regions' managers (db/33) */}
      {data.user.role === 'hudud_rahbari' && (
        <Link href="/admin/reja" className="navcard">
          <b>Haftalik reja</b>
          <small>Hududlaringizdagi xodimlarga reja tuzish</small>
        </Link>
      )}

      {isAdmin && (
        <>
          <Link href="/admin/reja" className="navcard">
            <b>Haftalik reja</b>
            <small>Kim qaysi do&apos;konga borishi va kim bormagani</small>
          </Link>
          <Link href="/admin/mml" className="navcard">
            <b>MML</b>
            <small>Majburiy assortiment va yetishmayotgan kitoblar</small>
          </Link>
          <Link href="/admin/hisobot" className="navcard">
            <b>Hisobot</b>
            <small>Grafiklar va menejerlar</small>
          </Link>
          <Link href="/admin/savollar" className="navcard">
            <b>Savollar bo&apos;yicha</b>
            <small>Har bir savol uchun diagramma</small>
          </Link>
          <Link href="/admin/forma" className="navcard">
            <b>Forma</b>
            <small>Savollarni tahrirlash va tartiblash</small>
          </Link>
          <Link href="/admin/sozlash" className="navcard">
            <b>Sozlash</b>
            <small>So&apos;rovlarni tasdiqlash va do&apos;konlarni taqsimlash</small>
          </Link>
          <Link href="/admin/users" className="navcard">
            <b>Xodimlar</b>
            <small>Qo&apos;shish va tahrirlash</small>
          </Link>
          <Link href="/admin/sheets" className="navcard">
            <b>Google Sheets</b>
            <small>Vizitlarni jadvalga yuborish</small>
          </Link>
          <Link href="/admin/tekshiruv" className="navcard">
            <b>Tekshiruv</b>
            <small>Test vizit yuborib, natijani tekshirish</small>
          </Link>
        </>
      )}
    </main>
  )
}
