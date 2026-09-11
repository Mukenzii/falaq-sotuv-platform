import { redirect } from 'next/navigation'
import { sql, type SQL } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { currentUserId } from '@/lib/session'
import { Filters, Donut, Bars, TextList } from './Parts'
import { questionColumns } from '@/lib/form/export'
import { answerFacets, answerText, type AnswerValue } from '@/lib/form/answers'
import { TYPE_META, type FormDoc } from '@/lib/form/types'

const FACING: Record<string, string> = {
  face: "Hammasi FACE bilan (muqova ko'rinib turibdi)",
  qisman_face: 'Qisman FACE',
  koreshok: 'Faqat yon tomoni (koreshok)',
  qutida: 'Qutida / ochilmagan holda',
}
const money = new Intl.NumberFormat('uz-UZ')

type Params = { kun?: string; manager?: string }

export default async function Savollar({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await currentUserId()
  if (!me) redirect('/login')
  const q = await searchParams

  const days = q.kun === '30' ? 30 : q.kun === 'all' ? null : 90
  const managerId = q.manager && q.manager !== 'all' ? q.manager : null

  const d = await asUser(me, async (db) => {
    const user = (await db.execute(sql`select full_name, role from users where id = ${me}`)).rows[0] as any

    // one predicate, reused by every question, so a filter cannot apply unevenly
    const where: SQL = sql`true
      ${days ? sql`and v.visited_at > now() - (${days} || ' days')::interval` : sql``}
      ${managerId ? sql`and v.manager_id = ${managerId}` : sql``}`

    const one = async (s: SQL) => (await db.execute(s)).rows as any[]

    const total = Number((await one(sql`select count(*) c from visits v where ${where}`))[0].c)

    // a checkbox answer is an array; count each chosen option separately
    const multi = (col: SQL) => one(sql`
      select x.label, count(*) value
        from visits v, unnest(${col}) as x(label)
       where ${where} group by 1 order by 2 desc`)

    return {
      user,
      total,
      managers: await one(sql`select id, full_name from users where role = 'sotuv_manager' order by full_name`),
      byManager: await one(sql`
        select u.full_name label, count(*) value from visits v
          join users u on u.id = v.manager_id where ${where} group by 1 order by 2 desc`),
      byRegion: await one(sql`
        select s.region label, count(*) value from visits v
          join stores s on s.id = v.store_id where ${where} group by 1 order by 2 desc`),
      byStore: await one(sql`
        select s.code label, count(*) value from visits v
          join stores s on s.id = v.store_id where ${where} group by 1 order by 2 desc`),
      size: (await one(sql`
        select round(avg(area_m2),1) avg_area, min(area_m2) min_area, max(area_m2) max_area,
               count(*) filter (where area_m2 is not null) n
          from visits v where ${where}`))[0],
      hours: await one(sql`
        select to_char(open_from,'HH24:MI') || ' - ' || to_char(open_to,'HH24:MI') label, count(*) value
          from visits v where ${where} and open_from is not null group by 1 order by 2 desc`),
      placement: await multi(sql`v.placement`),
      facing: await one(sql`
        select facing::text label, count(*) value from visits v
         where ${where} and facing is not null group by 1 order by 2 desc`),
      shelf: await multi(sql`v.shelf_heights`),
      present: await one(sql`
        select b.title label, count(*) value from visit_books vb
          join visits v on v.id = vb.visit_id join books b on b.id = vb.book_id
         where ${where} and vb.status = 'present' group by 1 order by 2 desc`),
      stale: await one(sql`
        select b.title label, count(*) value from visit_books vb
          join visits v on v.id = vb.visit_id join books b on b.id = vb.book_id
         where ${where} and vb.status = 'stale' group by 1 order by 2 desc`),
      photos: await one(sql`
        select p.object_key from visit_photos p
          join visits v on v.id = p.visit_id where ${where} order by p.created_at desc limit 8`),
      photoCount: Number((await one(sql`
        select count(*) c from visit_photos p join visits v on v.id = p.visit_id where ${where}`))[0].c),
      result: await multi(sql`v.visit_result`),
      noOrder: await one(sql`
        select no_order_reason label, count(*) value from visits v
         where ${where} and no_order_reason is not null group by 1 order by 2 desc`),
      debt: await one(sql`
        select debt_status label, count(*) value from visits v
         where ${where} and debt_status is not null group by 1 order by 2 desc`),
      cash: (await one(sql`
        select coalesce(sum(cash_collected),0) total, count(*) filter (where cash_collected is not null) n
          from visits v where ${where}`))[0],
      // Questions the admin added chart themselves: the columns come from the
      // form document and the tallying from the same helper the exports use, so
      // a new question needs no code here at all.
      versions: await one(sql`select version, status, doc from form_versions order by version desc`),
      customAnswers: await one(sql`
        select va.block_key, va.value from visit_answers va
          join visits v on v.id = va.visit_id where ${where}`),
      notes: await one(sql`
        select note from visits v where ${where} and note is not null and note <> '' order by v.visited_at desc limit 40`),
    }
  })

  if (!d.user) redirect('/login')
  if (d.user.role === 'sotuv_manager') redirect('/')

  const n = (rows: any[]) => rows.map((r) => ({ label: String(r.label), value: Number(r.value) }))
  const sum = (rows: any[]) => rows.reduce((a, r) => a + Number(r.value), 0)

  const questions = questionColumns(
    d.versions as Array<{ version: number; status: string; doc: FormDoc }>,
    d.customAnswers.map((a) => String(a.block_key)),
  )

  return (
    <main id="main" className="wrap">
      <h1>Savollar bo&apos;yicha</h1>
      <p className="sub">{money.format(d.total)} ta vizit</p>

      <Filters managers={d.managers as any} />

      <h2>Sotuv manager</h2>
      <Donut slices={n(d.byManager)} total={sum(d.byManager)} />

      <h2>Hudud</h2>
      <Bars rows={n(d.byRegion)} total={d.total} />

      <h2>Do&apos;kon nomi</h2>
      <Bars rows={n(d.byStore)} total={d.total} />

      <h2>Do&apos;kon razmeri</h2>
      <p className="stat">
        {d.size.n
          ? <>O&apos;rtacha <b>{d.size.avg_area} m²</b> · eng kichigi {d.size.min_area} m² · eng kattasi {d.size.max_area} m² · {d.size.n} ta o&apos;lchov</>
          : 'O’lchov kiritilmagan'}
      </p>

      <h2>Do&apos;kon ishlash vaqti</h2>
      <Bars rows={n(d.hours)} total={d.total} top={6} />

      <h2>Do&apos;konga kirganda kitoblarimiz qayerda joylashgan?</h2>
      <Bars rows={n(d.placement)} total={d.total} />

      <h2>Kitoblarimiz qanday turibdi?</h2>
      <Donut slices={d.facing.map((r) => ({ label: FACING[r.label] ?? r.label, value: Number(r.value) }))}
        total={sum(d.facing)} />

      <h2>Javonning qaysi qismida turibdi?</h2>
      <Bars rows={n(d.shelf)} total={d.total} />

      <h2>Qaysi kitoblarimiz turibdi?</h2>
      <Bars rows={n(d.present)} total={d.total} unit="marta" />

      <h2>Qaysi kitoblar turib qolgan (1 oydan beri sotilmayapti)?</h2>
      <Bars rows={n(d.stale)} total={d.total} unit="marta" />

      <h2>Javon / do&apos;kon rasmi</h2>
      {d.photoCount ? (
        <>
          <p className="stat">{money.format(d.photoCount)} ta rasm</p>
          <div className="photostrip">
            {d.photos.map((p) => (
              <img key={p.object_key} src={`/api/uploads/view?key=${encodeURIComponent(p.object_key)}`}
                alt="Javon rasmi" width={92} height={92} loading="lazy" />
            ))}
          </div>
        </>
      ) : <p className="empty">Rasm yo&apos;q</p>}

      <h2>Vizit natijasi</h2>
      <Bars rows={n(d.result)} total={d.total} />

      <h2>Buyurtma bo&apos;lmasa — sababi</h2>
      <Donut slices={n(d.noOrder)} total={sum(d.noOrder)} />

      <h2>Qarzdorlik holati</h2>
      <Donut slices={n(d.debt)} total={sum(d.debt)} />

      <h2>Bugun yig&apos;ilgan pul</h2>
      <p className="stat">
        Jami <b>{money.format(Number(d.cash.total))} so&apos;m</b> · {d.cash.n} ta vizitda kiritilgan
      </p>

      <h2>Shikoyat yoki taklif</h2>
      <TextList items={d.notes.map((r) => r.note)} />

      {/* whatever the admin added to the form charts itself, no code change needed */}
      {questions.map((q) => {
        const mine = d.customAnswers.filter((a) => a.block_key === q.id)
        const free = TYPE_META[q.type]?.group === 'text'

        if (free) {
          const texts = mine.map((a) => answerText(q, a.value as AnswerValue)).filter(Boolean)
          return (
            <section key={q.id}>
              <h2>{q.title}</h2>
              {texts.length ? <TextList items={texts} /> : <p className="empty">Javob yo&apos;q</p>}
            </section>
          )
        }

        const tally = new Map<string, number>()
        for (const a of mine) {
          for (const facet of answerFacets(q, a.value as AnswerValue)) {
            tally.set(facet, (tally.get(facet) ?? 0) + 1)
          }
        }
        const rows = [...tally.entries()]
          .map(([label, value]) => ({ label, value }))
          .sort((x, y) => y.value - x.value)

        return (
          <section key={q.id}>
            <h2>{q.title}</h2>
            {!rows.length ? <p className="empty">Javob yo&apos;q</p>
              : TYPE_META[q.type]?.single ? <Donut slices={rows} total={sum(rows)} />
              : <Bars rows={rows} total={d.total} />}
          </section>
        )
      })}
    </main>
  )
}
