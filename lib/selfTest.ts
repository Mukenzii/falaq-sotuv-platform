import { sql } from 'drizzle-orm'
import { asUser, pgArray } from '@/lib/db'
import { deleteObjects, isConfigured as storageConfigured, putObject } from '@/lib/minio'
import { isConfigured as sheetsConfigured, listTabs, masterTabTitle, readTabs, regionTabTitle } from '@/lib/sheets'
import { markSheetsDirty, runSheetsSync, sheetsPushedSince } from '@/lib/sheetsSync'
import { traversedSections } from '@/lib/form/core'
import type { AnswerFile, AnswerValue, Answers } from '@/lib/form/answers'
import type { FormDoc, QuestionBlock } from '@/lib/form/types'

/**
 * The production check behind /admin/tekshiruv.
 *
 * It files one visit the way a phone does — through POST /api/visits, under
 * the signed-in admin's own session, against a published form it fills in by
 * itself — then watches the automatic push put that visit into the master tab
 * and its region's tab and nowhere else. Then it takes every trace away: the
 * visit, its answers, books and photo, the shop it was filed against, and the
 * rows in the spreadsheet, and checks that they are gone.
 *
 * The shop is a throwaway one owned by the admin running the test, so no real
 * manager's shop changes hands and v_insert is satisfied honestly. Its code
 * carries TEST_PREFIX; anything with that prefix is test debris, and every run
 * sweeps it up first, so a run that died halfway is cleaned by the next one.
 *
 * Cleanup deletes directly rather than through DELETE /api/visits, because that
 * route writes deleted_visits — a log the app role may not edit afterwards, and
 * a test that leaves a permanent row behind has not cleaned up after itself.
 */

export const TEST_PREFIX = 'TEST-TEKSHIRUV-'

export type StepState = 'ok' | 'fail' | 'skip'
export type Step = { name: string; state: StepState; detail: string }
export type SelfTestResult = { ok: boolean; region: { code: string; name: string }; steps: Step[] }

export class SelfTestBusy extends Error {}
export class UnknownRegion extends Error {}

// the core answers the visit form offers, first of each list (Renderer.tsx)
const PLACEMENT = "Kirish yo'lida / vitrinada"
const SHELF = "Ko'z darajasida (135–160 sm)"
const RESULT = ['Kirdim / Taklif berdim', 'Buyurtma oldim']
const DEBT = "Qarz yo'q"
const NOTE = "TEST — avtomatik tekshiruv, o'zi o'chadi"

// a 1x1 JPEG: real image bytes, a few hundred of them
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////' +
  '////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/' +
  '2gAIAQEAAD8AN//Z', 'base64')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const msg = (e: unknown) => (e as Error)?.message ?? String(e)

let running = false
export const selfTestRunning = () => running

/** A valid answer for any question type, honouring its validation rule. */
function sampleAnswer(q: QuestionBlock, file: AnswerFile): AnswerValue {
  const first = q.options?.find((o) => !o.other)?.label ?? 'TEST'
  const v = q.validation
  switch (q.type) {
    case 'short_answer':
    case 'paragraph': {
      if (v?.kind === 'number' || v?.kind === 'integer') {
        const int = v.kind === 'integer'
        const n = v.min != null ? (int ? Math.ceil(v.min) : v.min)
          : v.max != null ? (int ? Math.floor(v.max) : v.max) : 1
        return String(n)
      }
      if (v?.kind === 'email') return 'test@example.com'
      if (v?.kind === 'url') return 'https://example.com'
      if (v?.kind === 'length') {
        const text = 'TEST'.padEnd(Math.max(v.min ?? 0, 4), 'x')
        return v.max != null ? text.slice(0, Math.max(v.max, 1)) : text
      }
      return 'TEST'
    }
    case 'multiple_choice':
    case 'dropdown':     return first
    case 'checkboxes':   return [first]
    case 'linear_scale': return q.scale?.min ?? 1
    case 'rating':       return 1
    case 'date':         return new Date().toISOString().slice(0, 10)
    case 'time':         return '09:00'
    case 'grid_radio':
      return Object.fromEntries((q.grid?.rows ?? []).map((r) => [r.id, q.grid?.cols[0]?.label ?? '']))
    case 'grid_checkbox':
      return Object.fromEntries((q.grid?.rows ?? []).map((r) => [r.id, [q.grid?.cols[0]?.label ?? '']]))
    case 'file_upload':  return [file]
  }
}

/**
 * Answers to every added question on the pages this response actually walks
 * through. An answer can change where the form branches, so fill and prune
 * until the path stops moving: the server rejects an answer to a question the
 * path never reached.
 */
function sampleAnswers(doc: FormDoc, file: AnswerFile): Answers {
  const answers: Answers = {}
  for (let pass = 0; pass <= doc.sections.length; pass++) {
    const reached = traversedSections(doc, answers).flatMap((s) => s.blocks)
      .filter((b): b is QuestionBlock => b.kind === 'question' && !b.hidden && !b.coreKey)
    const ids = new Set(reached.map((q) => q.id))
    let changed = false
    for (const q of reached) if (!(q.id in answers)) { answers[q.id] = sampleAnswer(q, file); changed = true }
    for (const id of Object.keys(answers)) if (!ids.has(id)) { delete answers[id]; changed = true }
    if (!changed) break
  }
  return answers
}

/** Remove everything with the test prefix. Returns what it removed. */
async function sweep(me: string) {
  const out = await asUser(me, async (db) => {
    const visits = (await db.execute(sql`
      select v.id from visits v join stores s on s.id = v.store_id
       where s.code like ${TEST_PREFIX + '%'}`)).rows.map((r) => (r as { id: string }).id)
    const ids = pgArray(visits)
    const files = (await db.execute(sql`
      select object_key from visit_photos where visit_id = any(${ids}::uuid[])
       union
      select e->>'object_key' from visit_answers a
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(a.value) = 'array' then a.value else '[]'::jsonb end) e
       where a.visit_id = any(${ids}::uuid[]) and jsonb_exists(e, 'object_key')`)).rows
      .map((r) => (r as { object_key: string }).object_key).filter(Boolean)
    await db.execute(sql`delete from visit_answers where visit_id = any(${ids}::uuid[])`)
    await db.execute(sql`delete from visit_books   where visit_id = any(${ids}::uuid[])`)
    await db.execute(sql`delete from visit_photos  where visit_id = any(${ids}::uuid[])`)
    await db.execute(sql`delete from visits        where id       = any(${ids}::uuid[])`)
    const stores = await db.execute(sql`
      delete from stores where code like ${TEST_PREFIX + '%'} returning id`)
    return { visits: visits.length, stores: stores.rows.length, files }
  })
  const photos = await deleteObjects(out.files)
  return { ...out, photos }
}

/** Every tab of the export spreadsheet that holds this visit's id. */
async function tabsHolding(visitId: string) {
  const tabs = await listTabs()
  const master = await masterTabTitle(tabs)
  const titles = tabs.map((t) => t.title)
  const all = await readTabs(titles)
  const found = titles.filter((t) => (all.get(t) ?? []).some((row) => row.some((c) => String(c).includes(visitId))))
  return { master, titles, found }
}

export async function runSelfTest(
  me: string,
  regionCode: string,
  call: { origin: string; cookie: string },
): Promise<SelfTestResult> {
  if (running) throw new SelfTestBusy()
  running = true

  const steps: Step[] = []
  const step = (name: string, state: StepState, detail: string) => steps.push({ name, state, detail })
  const api = (path: string, body: unknown) => fetch(`${call.origin}${path}`, {
    method: 'POST',
    headers: { cookie: call.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  let region = { code: regionCode, name: regionCode }
  let visitId: string | null = null
  let reachedSheet = false

  try {
    const found = await asUser(me, async (db) => (await db.execute(sql`
      select code, name from regions where code = ${regionCode}`)).rows[0] as typeof region | undefined)
    if (!found) throw new UnknownRegion(`Bunday viloyat yo'q: ${regionCode}`)
    region = found

    try {
      // 1. debris from a run that never finished
      const old = await sweep(me)
      step('Oldingi testdan qolganlar', 'ok', old.stores || old.visits
        ? `${old.stores} ta test do'kon, ${old.visits} ta vizit topildi va o'chirildi`
        : 'yo\'q, baza toza')

      // 2. a shop of this region that belongs to the admin running the test
      const store = await asUser(me, async (db) => {
        const r = await db.execute(sql`
          insert into stores (code, name, region, territory, owner_id, active)
          values (${TEST_PREFIX + Date.now()}, ${"TEST do'kon (o'zi o'chadi)"}, ${region.name},
                  ${region.code + ' TEST'}, ${me}, true)
          returning id, code, region_code`)
        return r.rows[0] as { id: number; code: string; region_code: string | null }
      })
      if (store.region_code !== region.code) {
        throw new Error(`test do'kon ${store.region_code ?? 'hududsiz'} viloyatiga tushdi, ${region.code} emas`)
      }
      step("Test do'kon yaratildi", 'ok', `${store.code} → ${region.code} ${region.name}`)

      // 3. the shelf photo: a server-chosen key from the real presign route
      const pre = await api('/api/uploads/presign', { contentType: 'image/jpeg', bytes: JPEG.length, kind: 'image' })
      const preBody = await pre.json().catch(() => ({}))
      if (!pre.ok || !preBody.objectKey) throw new Error(`rasm havolasi berilmadi: ${preBody.error ?? pre.status}`)
      const photo = { object_key: preBody.objectKey as string, content_type: 'image/jpeg', bytes: JPEG.length }
      if (storageConfigured()) {
        try {
          await putObject(photo.object_key, JPEG, 'image/jpeg')
          step('Rasm saqlandi', 'ok', photo.object_key)
        } catch (e) {
          step('Rasm saqlandi', 'fail', msg(e))
        }
      } else {
        step('Rasm saqlandi', 'skip', 'MinIO sozlanmagan')
      }

      // 4. the visit, through the same route and checks as a phone
      const form = await asUser(me, async (db) => (await db.execute(sql`
        select doc from form_versions where status = 'published' limit 1`)).rows[0] as { doc: FormDoc } | undefined)
      if (!form) throw new Error('Forma nashr qilinmagan')
      const book = await asUser(me, async (db) => (await db.execute(sql`
        select id from books where active order by id limit 1`)).rows[0] as { id: number } | undefined)
      const answers = sampleAnswers(form.doc, { ...photo, name: 'test.jpg' })
      const res = await api('/api/visits', {
        store_id: store.id, width_m: '1', height_m: '1', open_from: '09:00', open_to: '18:00',
        placement: [PLACEMENT], facing: 'face', shelf_heights: [SHELF], photos: [photo],
        present_book_ids: book ? [book.id] : [], visit_result: RESULT, debt_status: DEBT,
        cash_collected: '0', note: NOTE, answers,
      })
      const visit = await res.json().catch(() => ({}))
      if (res.status !== 201 || !visit.id) throw new Error(`vizit saqlanmadi: ${visit.error ?? res.status}`)
      visitId = visit.id as string
      step('Vizit yuborildi', 'ok', `16 ta asosiy savol va ${Object.keys(answers).length} ta qo'shimcha savol to'ldirildi`)

      // 5. what landed in the database
      const row = await asUser(me, async (db) => (await db.execute(sql`
        select s.region_code, extract(epoch from v.created_at)::float8 as at,
               (select count(*) from visit_photos  where visit_id = v.id)::int as photos,
               (select count(*) from visit_books   where visit_id = v.id)::int as books,
               (select count(*) from visit_answers where visit_id = v.id)::int as answers
          from visits v join stores s on s.id = v.store_id where v.id = ${visitId}`)).rows[0] as
        { region_code: string; at: number; photos: number; books: number; answers: number } | undefined)
      if (!row) throw new Error('vizit bazada topilmadi')
      step('Bazaga yozildi', row.region_code === region.code && row.photos === 1 ? 'ok' : 'fail',
        `viloyat ${row.region_code}, ${row.photos} ta rasm, ${row.books} ta kitob, ${row.answers} ta qo'shimcha javob`)

      // 6. the push the visit set off by itself — nobody presses a button
      if (!sheetsConfigured()) {
        step('Jadvalga avtomatik yuborildi', 'skip', 'Google Sheets sozlanmagan')
      } else {
        const started = Date.now()
        let s = await sheetsPushedSince(row.at)
        while (!s.paused && !(s.done && !s.dirty) && Date.now() - started < 90_000) {
          await sleep(2000)
          s = await sheetsPushedSince(row.at)
        }
        if (s.paused) throw new Error("avtomatik yuborish to'xtatilgan (/admin/sheets)")
        if (!s.done || s.dirty) throw new Error(`jadval 90 soniyada yangilanmadi${s.last_error ? `: ${s.last_error}` : ''}`)
        reachedSheet = true
        step('Jadvalga avtomatik yuborildi', 'ok', `${Math.round((Date.now() - started) / 1000)} soniyada`)

        // 7. exactly the master tab and the region's own tab
        const t = await tabsHolding(visitId)
        const regionTab = regionTabTitle(region.code, region.name, t.titles, t.master)
        const right = t.found.length === 2 && t.found.includes(t.master) && t.found.includes(regionTab)
        step("To'g'ri varaqlarga tushdi", right ? 'ok' : 'fail', right
          ? `"${t.master}" va "${regionTab}" — boshqa varaqlarda yo'q`
          : `kutilgan: "${t.master}", "${regionTab}"; topildi: ${t.found.map((x) => `"${x}"`).join(', ') || 'hech qayerda'}`)
      }
    } catch (e) {
      step('Xatolik', 'fail', msg(e))
    } finally {
      // 8. every trace in the database and in storage, whatever happened above
      try {
        const gone = await sweep(me)
        step("Test ma'lumotlari o'chirildi", 'ok',
          `${gone.visits} ta vizit, ${gone.stores} ta do'kon, ${gone.photos} ta rasm`)
      } catch (e) {
        step("Test ma'lumotlari o'chirildi", 'fail', `${msg(e)} — testni qayta ishga tushiring, u qoldiqni tozalaydi`)
      }

      // 9. and in the spreadsheet: push again, then look
      if (visitId && reachedSheet) {
        try {
          await markSheetsDirty()
          let out = await runSheetsSync()
          for (let i = 0; !out.ok && out.reason === 'busy' && i < 20; i++) {
            await sleep(3000)
            out = await runSheetsSync()
          }
          if (!out.ok) throw new Error(out.reason === 'failed' ? out.error ?? 'xatolik' : out.reason)
          const t = await tabsHolding(visitId)
          step("Jadvaldan ham o'chdi", t.found.length ? 'fail' : 'ok', t.found.length
            ? `hali bor: ${t.found.map((x) => `"${x}"`).join(', ')}`
            : 'test qatori hech bir varaqda qolmadi')
        } catch (e) {
          step("Jadvaldan ham o'chdi", 'fail', `${msg(e)} — keyingi yuborishda o'chadi`)
        }
      }
    }
  } finally {
    running = false
  }

  return { ok: steps.every((s) => s.state !== 'fail'), region, steps }
}
