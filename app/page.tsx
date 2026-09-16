import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { currentUserId } from '@/lib/session'
import Link from 'next/link'

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
    return { user: u.rows[0] as { full_name: string; role: string } | undefined, stat: s.rows[0] as any }
  })

  if (!data.user) redirect('/login')
  const isAdmin = data.user.role === 'direktor' || data.user.role === 'sotuv_boshligi'
  const { kerak, reja, bajarildi, today, week } = data.stat

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

      <h2>Ko&apos;rish</h2>
      <Link href="/dokon" className="navcard">
        <b>Do&apos;konlar</b>
        <small>Har bir do&apos;kon va uning tarixi</small>
      </Link>

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
        </>
      )}
    </main>
  )
}
