import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { asUser, pgArray, pgCode } from '@/lib/db'
import { requireUserId } from '@/lib/session'
import { pushSheetsSoon } from '@/lib/sheetsSync'
import { coreFilled, traversedSections } from '@/lib/form/core'
import { isEmpty, validateAnswer, type Answers } from '@/lib/form/answers'
import type { FormDoc, QuestionBlock } from '@/lib/form/types'

export async function GET(req: Request) {
  const me = await requireUserId()
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 50), 200)

  const rows = await asUser(me, async (db) => {
    const r = await db.execute(sql`
      select v.id, v.visited_at, v.took_order, v.debt_status, v.cash_collected,
             u.full_name as manager, s.code as store,
             (select count(*) from visit_books b where b.visit_id = v.id and b.status='present') as n_present,
             (select count(*) from visit_books b where b.visit_id = v.id and b.status='stale')   as n_stale,
             (select count(*) from visit_photos p where p.visit_id = v.id)                        as n_photos
        from visits v
        join users u on u.id = v.manager_id
        join stores s on s.id = v.store_id
       order by v.visited_at desc
       limit ${limit}`)
    return r.rows
  })
  return NextResponse.json(rows)
}

/**
 * One visit + its book rows in a single transaction, so a half-written visit
 * with no books can never land. asUser() already wraps this in BEGIN/COMMIT.
 */
export async function POST(req: Request) {
  const me = await requireUserId()
  const b = await req.json()

  if (!b.store_id) {
    return NextResponse.json({ error: "do'kon tanlanmagan" }, { status: 400 })
  }

  // A manager may only file against a shop that is theirs outright or on their
  // weekly plan (db/31). The RLS policy v_insert enforces this on its own, but
  // a policy violation arrives as a bare 42501 after the whole body has been
  // validated and the photos uploaded — so check it up front, with the same
  // function the policy uses, and say which shop and why.
  const owned = await asUser(me, async (db) => {
    const r = await db.execute(sql`
      select s.code, store_is_mine(s.id) as meniki, s.active
        from stores s where s.id = ${b.store_id}`)
    return r.rows[0] as { code: string; meniki: boolean; active: boolean } | undefined
  })
  if (!owned) {
    return NextResponse.json({ error: "Bunday do'kon yo'q" }, { status: 404 })
  }
  if (!owned.active) {
    return NextResponse.json({ error: `${owned.code} — bu do'kon faol emas` }, { status: 403 })
  }
  if (!owned.meniki) {
    return NextResponse.json(
      { error: `${owned.code} sizga biriktirilmagan — rahbaringizga ayting` },
      { status: 403 },
    )
  }

  // Uzbek/Russian keyboards produce "7,5"; Number() makes that NaN. Accept both
  // separators here so the API is not stricter than the people using it.
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) ? n : NaN
  }

  // A shop has no negative width, and no one collects negative money. Two
  // negative sides would also multiply into a plausible-looking positive area.
  const numeric: Array<[string, unknown, 'positive' | 'nonneg']> = [
    ['Eni', b.width_m, 'positive'],
    ["Bo'yi", b.height_m, 'positive'],
    ["Bugun yig'ilgan pul", b.cash_collected, 'nonneg'],
  ]
  for (const [label, raw, rule] of numeric) {
    const n = num(raw)
    if (n === null) continue
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: `${label}: raqam kiriting` }, { status: 400 })
    }
    if (rule === 'positive' ? n <= 0 : n < 0) {
      return NextResponse.json(
        { error: rule === 'positive'
            ? `${label} 0 dan katta bo'lishi kerak`
            : `${label} manfiy bo'lishi mumkin emas` },
        { status: 400 },
      )
    }
  }

  // The published form decides what is required and what shape each answer
  // takes, so a question added in the editor is validated here without a code
  // change — and a client that skips its own checks is held to the same rule.
  const published = await asUser(me, async (db) => {
    const r = await db.execute(sql`
      select version, doc from form_versions where status = 'published' limit 1`)
    return r.rows[0] as { version: number; doc: FormDoc } | undefined
  })
  if (!published) {
    return NextResponse.json({ error: "Forma hali nashr qilinmagan" }, { status: 409 })
  }

  const answers: Answers = b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers)
    ? b.answers
    : {}
  const reached = traversedSections(published.doc, answers)
  const asked: QuestionBlock[] = reached.flatMap((s) =>
    s.blocks.filter((x): x is QuestionBlock => x.kind === 'question' && !x.hidden))

  for (const q of asked) {
    if (q.coreKey) {
      if (q.required && !coreFilled(q, b)) {
        return NextResponse.json({ error: `${q.title}: bu savol majburiy` }, { status: 400 })
      }
      continue
    }
    const err = validateAnswer(q, answers[q.id] ?? null)
    if (err) return NextResponse.json({ error: `${q.title}: ${err}` }, { status: 400 })
  }

  // an answer to a question this form does not ask is a stale client or a
  // forged body; either way it must not be written under someone else's id
  const askedIds = new Set(asked.map((q) => q.id))
  for (const key of Object.keys(answers)) {
    if (!askedIds.has(key) && !isEmpty(answers[key])) {
      return NextResponse.json({ error: 'Formada bunday savol yo\'q' }, { status: 400 })
    }
  }

  try {
    const visit = await asUser(me, async (db) => {
      const r = await db.execute(sql`
        insert into visits (
          manager_id, store_id, width_m, height_m, open_from, open_to,
          placement, facing, shelf_heights, visit_result, no_order_reason,
          debt_status, cash_collected, note, lat, lng, form_version)
        values (
          ${me}, ${b.store_id}, ${num(b.width_m)}, ${num(b.height_m)},
          ${b.open_from ?? null}, ${b.open_to ?? null},
          ${pgArray(b.placement)}::text[], ${b.facing ?? null},
          ${pgArray(b.shelf_heights)}::text[],
          ${pgArray(b.visit_result)}::text[], ${b.no_order_reason ?? null},
          ${b.debt_status ?? null}, ${num(b.cash_collected)}, ${b.note ?? null},
          ${b.lat ?? null}, ${b.lng ?? null}, ${published.version})
        returning id, visited_at, took_order`)
      const v = r.rows[0] as { id: string }

      const photos: Array<{ object_key: string; content_type?: string; bytes?: number }> =
        Array.isArray(b.photos) ? b.photos.slice(0, 10) : []
      for (const ph of photos) {
        if (typeof ph?.object_key !== 'string' || !ph.object_key) continue
        await db.execute(sql`
          insert into visit_photos (visit_id, object_key, content_type, bytes)
          values (${v.id}, ${ph.object_key}, ${ph.content_type ?? null}, ${ph.bytes ?? null})`)
      }

      // answers to questions the admin added in the form editor. The key is the
      // block id from the document, so the answer stays attached to its question
      // through every later edit — and through renaming it.
      for (const [blockKey, value] of Object.entries(answers)) {
        if (isEmpty(value)) continue
        await db.execute(sql`
          insert into visit_answers (visit_id, block_key, value)
          values (${v.id}, ${blockKey}, ${JSON.stringify(value)}::jsonb)
          on conflict (visit_id, block_key) do update set value = excluded.value`)
      }

      const present: number[] = b.present_book_ids ?? []
      const stale: number[] = b.stale_book_ids ?? []
      if (present.length || stale.length) {
        await db.execute(sql`
          insert into visit_books (visit_id, book_id, status)
          select ${v.id}, x.book_id, x.status from (
            select unnest(${pgArray(present)}::bigint[]) as book_id, 'present'::book_status as status
            union all
            select unnest(${pgArray(stale)}::bigint[]), 'stale'::book_status
          ) x
          on conflict do nothing`)
      }
      return v
    })

    // The spreadsheet is updated after this response, never before it: a
    // manager in a shop must not wait on Google, and must never be told their
    // visit failed because Sheets did. A failure here is retried in the
    // background, so the row still arrives.
    pushSheetsSoon()

    return NextResponse.json(visit, { status: 201 })
  } catch (e: unknown) {
    // the CHECK constraints are the last line if anything slips past the above
    if (pgCode(e) === '23514') {
      return NextResponse.json({ error: "Raqamlar manfiy bo'lishi mumkin emas" }, { status: 400 })
    }
    if (pgCode(e) === '42501') {
      return NextResponse.json({ error: "bu do'kon sizga biriktirilmagan" }, { status: 403 })
    }
    throw e
  }
}
