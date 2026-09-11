import { sql } from 'drizzle-orm'
import { asUser } from '@/lib/db'
import { requireMe } from '@/lib/auth'
import { errorResponse } from '@/lib/form/http'
import { answerText, type AnswerValue } from '@/lib/form/answers'
import { questionColumns } from '@/lib/form/export'
import type { FormDoc } from '@/lib/form/types'

/**
 * Every response as one CSV row.
 *
 * Columns come from the form document, not from a hardcoded list, so a question
 * added in the editor appears here the moment it is published. Questions that
 * were removed still get a column if any response answered them — an export
 * that quietly drops old answers is worse than a wide file.
 *
 * The query runs under the caller's RLS, so a manager exports their own visits
 * and a direktor exports everyone's.
 */

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET() {
  try {
    const user = await requireMe()

    const data = await asUser(user.id, async (db) => {
      const versions = (await db.execute(sql`
        select version, status, doc from form_versions order by version desc`)).rows as
        Array<{ version: number; status: string; doc: FormDoc }>

      const visits = (await db.execute(sql`
        select v.id, v.visited_at, v.form_version, u.full_name as manager,
               s.code as store_code, s.name as store_name, s.region, s.channel,
               v.width_m, v.height_m, v.area_m2, v.open_from, v.open_to,
               v.placement, v.facing, v.shelf_heights, v.visit_result, v.took_order,
               v.no_order_reason, v.debt_status, v.cash_collected, v.note, v.lat, v.lng,
               (select string_agg(b.title, '; ' order by b.title) from visit_books vb
                  join books b on b.id = vb.book_id
                 where vb.visit_id = v.id and vb.status = 'present') as present_books,
               (select string_agg(b.title, '; ' order by b.title) from visit_books vb
                  join books b on b.id = vb.book_id
                 where vb.visit_id = v.id and vb.status = 'stale') as stale_books,
               (select count(*) from visit_photos p where p.visit_id = v.id) as photos
          from visits v
          join users u on u.id = v.manager_id
          join stores s on s.id = v.store_id
         order by v.visited_at desc`)).rows as any[]

      const answers = (await db.execute(sql`
        select va.visit_id, va.block_key, va.value
          from visit_answers va join visits v on v.id = va.visit_id`)).rows as
        Array<{ visit_id: string; block_key: string; value: AnswerValue }>

      return { versions, visits, answers }
    })

    const ordered = questionColumns(data.versions, data.answers.map((a) => a.block_key))

    const answersOf = new Map<string, Map<string, AnswerValue>>()
    for (const a of data.answers) {
      if (!answersOf.has(a.visit_id)) answersOf.set(a.visit_id, new Map())
      answersOf.get(a.visit_id)!.set(a.block_key, a.value)
    }

    const header = [
      'vizit_id', 'sana', 'forma_versiyasi', 'menejer', 'dokon_kodi', 'dokon_nomi', 'hudud', 'kanal',
      'eni_m', 'boyi_m', 'maydon_m2', 'ochilish', 'yopilish',
      'joylashuv', 'turishi', 'javon_qismi', 'natija', 'buyurtma_oldi',
      'buyurtma_yoq_sababi', 'qarzdorlik', 'yigilgan_pul', 'izoh',
      'turgan_kitoblar', 'turib_qolgan_kitoblar', 'rasmlar', 'lat', 'lng',
      ...ordered.map((q) => q.title),
    ]

    const lines = [header.map(csvCell).join(',')]
    for (const v of data.visits) {
      const mine = answersOf.get(v.id) ?? new Map()
      lines.push([
        v.id, new Date(v.visited_at).toISOString(), v.form_version, v.manager,
        v.store_code, v.store_name, v.region, v.channel,
        v.width_m, v.height_m, v.area_m2, v.open_from, v.open_to,
        (v.placement ?? []).join('; '), v.facing, (v.shelf_heights ?? []).join('; '),
        (v.visit_result ?? []).join('; '), v.took_order ? 'ha' : "yo'q",
        v.no_order_reason, v.debt_status, v.cash_collected, v.note,
        v.present_books, v.stale_books, v.photos, v.lat, v.lng,
        ...ordered.map((q) => answerText(q, mine.get(q.id) ?? null)),
      ].map(csvCell).join(','))
    }

    // Excel on a Windows machine reads UTF-8 only when it sees the BOM, and
    // these files are opened in Uzbek Excel with oʻ / gʻ in every store name.
    const body = '﻿' + lines.join('\r\n') + '\r\n'
    return new Response(body, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="vizitlar-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (e) {
    return errorResponse(e)
  }
}
