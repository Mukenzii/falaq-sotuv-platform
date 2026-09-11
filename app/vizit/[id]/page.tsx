import { notFound, redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { asUser } from '@/lib/db'
import { currentUserId } from '@/lib/session'
import { answerText, type AnswerFile, type AnswerValue } from '@/lib/form/answers'
import type { FormDoc, QuestionBlock } from '@/lib/form/types'

const FACING: Record<string, string> = {
  face: "Hammasi FACE bilan (muqova ko'rinib turibdi)",
  qisman_face: 'Qisman FACE',
  koreshok: 'Faqat yon tomoni (koreshok)',
  qutida: 'Qutida / ochilmagan holda',
}
const money = new Intl.NumberFormat('uz-UZ')
const when = new Intl.DateTimeFormat('uz-UZ', {
  day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null
  return (
    <div className="drow">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export default async function VisitDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUserId()
  if (!me) redirect('/login')
  const { id } = await params

  const d = await asUser(me, async (db) => {
    const v = (await db.execute(sql`
      select v.*, u.full_name manager, s.code store_code, s.name store_name,
             s.region, s.channel, s.id store_id
        from visits v
        join users u on u.id = v.manager_id
        join stores s on s.id = v.store_id
       where v.id = ${id}`)).rows[0] as any
    if (!v) return { visit: null }

    return {
      visit: v,
      books: (await db.execute(sql`
        select b.title, vb.status from visit_books vb
          join books b on b.id = vb.book_id
         where vb.visit_id = ${id} order by vb.status, b.title`)).rows as any[],
      photos: (await db.execute(sql`
        select object_key from visit_photos where visit_id = ${id} order by created_at`)).rows as any[],
      answers: (await db.execute(sql`
        select block_key, value from visit_answers where visit_id = ${id}`)).rows as
        Array<{ block_key: string; value: AnswerValue }>,
      // the version this response was actually filled under, not the current one:
      // that is the only document whose wording and options match these answers
      form: (await db.execute(sql`
        select doc from form_versions where version = ${v.form_version ?? 1}`)).rows[0] as
        { doc: FormDoc } | undefined,
    }
  })

  // RLS already hid anything outside this person's branch, so "not visible" and
  // "does not exist" are the same answer on purpose.
  if (!d.visit) notFound()

  const v = d.visit
  const present = d.books!.filter((b) => b.status === 'present')
  const stale = d.books!.filter((b) => b.status === 'stale')

  // Questions are looked up in that version's document, so a question renamed
  // or deleted since still shows the wording this manager answered.
  const byId = new Map<string, QuestionBlock>()
  for (const sec of d.form?.doc.sections ?? []) {
    for (const b of sec.blocks) if (b.kind === 'question' && !b.coreKey) byId.set(b.id, b)
  }
  const extra = (d.answers ?? [])
    .map((a) => ({ q: byId.get(a.block_key), value: a.value, key: a.block_key }))
    .filter((x) => x.value !== null && x.value !== undefined)

  return (
    <main id="main" className="wrap">
      <p className="crumb"><Link href={`/dokon/${v.store_id}`}>{v.store_code}</Link></p>
      <h1>{v.store_name}</h1>
      <p className="sub">{when.format(new Date(v.visited_at))}, {v.manager}</p>

      <dl className="detail">
        <Row label="Do&apos;kon kodi">{v.store_code}</Row>
        <Row label="Hudud">{v.region}</Row>
        <Row label="Kanal">{v.channel}</Row>
        <Row label="O&apos;lchami">
          {v.width_m && v.height_m ? `${v.width_m} × ${v.height_m} m` : null}
        </Row>
        <Row label="Javon maydoni">{v.area_m2 ? `${v.area_m2} m²` : null}</Row>
        <Row label="Ishlash vaqti">
          {v.open_from ? `${String(v.open_from).slice(0, 5)} – ${String(v.open_to ?? '').slice(0, 5)}` : null}
        </Row>
      </dl>

      <h2>Javon</h2>
      <dl className="detail">
        <Row label="Qayerda joylashgan">
          {v.placement?.length ? <ul className="taglist">{v.placement.map((p: string) => <li key={p}>{p}</li>)}</ul> : null}
        </Row>
        <Row label="Qanday turibdi">{v.facing ? FACING[v.facing] ?? v.facing : null}</Row>
        <Row label="Javonning qismi">
          {v.shelf_heights?.length ? <ul className="taglist">{v.shelf_heights.map((p: string) => <li key={p}>{p}</li>)}</ul> : null}
        </Row>
      </dl>

      <h2>Kitoblar</h2>
      <dl className="detail">
        <Row label={`Turgan (${present.length})`}>
          {present.length ? <ul className="taglist">{present.map((b) => <li key={b.title}>{b.title}</li>)}</ul> : null}
        </Row>
        <Row label={`Turib qolgan (${stale.length})`}>
          {stale.length ? <ul className="taglist bad">{stale.map((b) => <li key={b.title}>{b.title}</li>)}</ul> : null}
        </Row>
      </dl>

      {d.photos!.length > 0 && (
        <>
          <h2>Rasmlar</h2>
          <div className="photostrip">
            {d.photos!.map((p) => (
              <a key={p.object_key} href={`/api/uploads/view?key=${encodeURIComponent(p.object_key)}`} target="_blank" rel="noreferrer">
                <img src={`/api/uploads/view?key=${encodeURIComponent(p.object_key)}`}
                  alt="Javon rasmi" width={110} height={110} loading="lazy" />
              </a>
            ))}
          </div>
        </>
      )}

      {extra.length > 0 && (
        <>
          <h2>Qo&apos;shimcha savollar</h2>
          <dl className="detail">
            {extra.map(({ q, value, key }) => (
              <Row key={key} label={q?.title ?? `O'chirilgan savol (${key})`}>
                {q?.type === 'file_upload' && Array.isArray(value) ? (
                  <ul className="taglist">
                    {(value as AnswerFile[]).map((f) => (
                      <li key={f.object_key}>
                        <a href={`/api/uploads/view?key=${encodeURIComponent(f.object_key)}`}
                          target="_blank" rel="noreferrer">{f.name || f.object_key}</a>
                      </li>
                    ))}
                  </ul>
                ) : q ? answerText(q, value) : JSON.stringify(value)}
              </Row>
            ))}
          </dl>
        </>
      )}

      <h2>Natija</h2>
      <dl className="detail">
        <Row label="Vizit natijasi">
          {v.visit_result?.length ? <ul className="taglist">{v.visit_result.map((p: string) => <li key={p}>{p}</li>)}</ul> : null}
        </Row>
        <Row label="Buyurtma bo&apos;lmasa, sababi">{v.no_order_reason}</Row>
        <Row label="Qarzdorlik">{v.debt_status}</Row>
        <Row label="Yig&apos;ilgan pul">
          {v.cash_collected != null ? `${money.format(Number(v.cash_collected))} so'm` : null}
        </Row>
        <Row label="Izoh">{v.note}</Row>
        <Row label="GPS">
          {v.lat ? (
            <a href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noreferrer">
              {Number(v.lat).toFixed(4)}, {Number(v.lng).toFixed(4)}
            </a>
          ) : null}
        </Row>
      </dl>
    </main>
  )
}
