/**
 * MML in the browser, by the same rule as v_mml (db/35), so the visit form can
 * show it while an agent ticks titles — before anything is saved.
 *
 *   MML = required titles on the shelf / required titles
 *
 * Optional titles neither raise nor lower it and are never "missing". On the
 * shelf means: a hand-set value wins where there is one (store_stock — the
 * database lets it win over a visit too), otherwise what is ticked now. It is a
 * yes/no fact; there is no stock count in it. A store that requires nothing
 * has no MML: null, never 100%.
 *
 * Pure and free of path aliases so tests/mml.test.mjs can import it directly.
 */

export type MmlKind = 'majburiy' | 'ixtiyoriy'

/** v_mml.holat (db/35): why a shop has an MML, or why it has none. */
export type MmlHolat = 'ustun_yoq' | 'qoida_eskirgan' | 'majburiy_yoq' | 'olchanmagan' | 'olchangan'

/** What to tell a person about a shop without an MML. Every state says something. */
export const MML_HOLAT: Record<MmlHolat, string> = {
  ustun_yoq: "Bu do'kon turi MML jadvalida yo'q — majburiy kitoblar belgilanmagan",
  qoida_eskirgan: "MML qoidasi eskirgan — admin Google Sheets'dan qayta yuklashi kerak",
  majburiy_yoq: "Bu do'kon uchun majburiy kitob belgilanmagan",
  olchanmagan: "Hali o'lchanmagan — vizit ham, qo'lda belgi ham yo'q",
  olchangan: "O'lchangan",
}

/** The same, short enough for a table cell. */
export const MML_HOLAT_QISQA: Record<MmlHolat, string> = {
  ustun_yoq: "MML jadvalida yo'q",
  qoida_eskirgan: 'qoida eskirgan',
  majburiy_yoq: "majburiy kitob yo'q",
  olchanmagan: "o'lchanmagan",
  olchangan: '',
}

/** A shop whose required list can be scored at all (live, in the visit form). */
export const scorable = (h: string | null | undefined) => h === 'olchangan' || h === 'olchanmagan'
export type MmlTitle = {
  book_id: number | string
  title: string
  book_category: string | null
  kind: MmlKind
  /** on the shelf as the database sees it now */
  bor: boolean
  /** set by hand (store_stock); then `bor` is that hand-set value */
  qolda: boolean
}
export type MmlScore = { kerak: number; bor: number; foiz: number | null; missing: MmlTitle[] }

export function scoreMml(titles: MmlTitle[], ticked?: Set<number | string>): MmlScore {
  const required = titles.filter((t) => t.kind === 'majburiy')
  // ids arrive as numbers from one endpoint and as strings ("12", a bigint)
  // from another; compare them as text so a tick is never silently missed
  const picked = ticked && new Set([...ticked].map(String))
  const onShelf = (t: MmlTitle) => (t.qolda || !picked ? t.bor : picked.has(String(t.book_id)))
  const missing = required.filter((t) => !onShelf(t))
  const bor = required.length - missing.length
  return {
    kerak: required.length,
    bor,
    foiz: required.length ? Math.round((1000 * bor) / required.length) / 10 : null,
    missing,
  }
}
