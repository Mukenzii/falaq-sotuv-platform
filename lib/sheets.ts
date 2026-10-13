import { createSign } from 'node:crypto'

/**
 * Minimal Google Sheets client. Uses a service account, signing the JWT with
 * node:crypto so the app needs no Google SDK dependency.
 *
 * Setup:
 *   1. console.cloud.google.com -> create a service account -> add a JSON key
 *   2. Enable the Google Sheets API for that project
 *   3. Share the spreadsheet with the service account email as Editor
 *   4. Put the email, the private key and the spreadsheet URL in .env
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const API = 'https://sheets.googleapis.com/v4/spreadsheets'

export class SheetsNotConfigured extends Error {
  constructor(missing: string[]) {
    super(`Google Sheets sozlanmagan: .env da ${missing.join(', ')} yo'q`)
  }
}

function credentials() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  // .env keeps the key on one line with \n escapes
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const missing = [
    !email && 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    !key && 'GOOGLE_PRIVATE_KEY',
  ].filter(Boolean) as string[]
  if (missing.length) throw new SheetsNotConfigured(missing)
  return { email: email!, key: key! }
}

/**
 * Accepts what a person actually has to hand: the URL from the browser's
 * address bar. A bare id still works, so an older .env and the compose file
 * keep going.
 *
 * Every Sheets URL carries the id in the same place — /spreadsheets/d/<id>/ —
 * including the /edit#gid=0, ?usp=sharing and /copy variants Google hands out.
 */
export function spreadsheetIdFrom(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  const inUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(v)
  if (inUrl) return inUrl[1]
  // a bare id: no slashes, no spaces, and long enough not to be a typo
  if (/^[a-zA-Z0-9-_]{20,}$/.test(v)) return v
  return null
}

export class SheetsBadUrl extends Error {
  constructor(value: string) {
    super(`SHEETS_SPREADSHEET_URL tushunarsiz: ${value.slice(0, 60)} — jadval havolasini to'liq qo'ying`)
  }
}

function config() {
  const { email, key } = credentials()
  // URL is the documented one; ID stays supported so nothing already deployed breaks
  const raw = process.env.SHEETS_SPREADSHEET_URL || process.env.SHEETS_SPREADSHEET_ID
  if (!raw) throw new SheetsNotConfigured(['SHEETS_SPREADSHEET_URL'])
  const sheetId = spreadsheetIdFrom(raw)
  if (!sheetId) throw new SheetsBadUrl(raw)
  return { email, key, sheetId }
}

/** The tab a Sheets link points at (#gid=… or ?gid=…), or null for none. */
export function gidFrom(value: string): string | null {
  const m = /[#?&]gid=(\d+)/.exec(value ?? '')
  return m ? m[1] : null
}

/** The sheet (and tab) the export is pointed at, for writing and for the admin page. */
export function spreadsheetTarget(): { id: string; url: string; gid: string | null } | null {
  const raw = process.env.SHEETS_SPREADSHEET_URL || process.env.SHEETS_SPREADSHEET_ID
  const id = raw ? spreadsheetIdFrom(raw) : null
  const gid = raw ? gidFrom(raw) : null
  const url = `https://docs.google.com/spreadsheets/d/${id}/edit${gid ? `#gid=${gid}` : ''}`
  return id ? { id, url, gid } : null
}

/**
 * Where the must-list is read FROM: the weights tab ("MML") and the book
 * categories tab ("Kitoblar"). MML_SHEET_URL, else the store directory sheet,
 * since all of it lives in "Sotuv uchun". Read only — Viewer is enough.
 */
export function mmlSource(): { id: string; url: string; tab: string; booksTab: string } | null {
  const raw = process.env.MML_SHEET_URL
    || process.env.STORES_SHEET_URL
    || process.env.SHEETS_SPREADSHEET_URL
    || process.env.SHEETS_SPREADSHEET_ID
  const id = raw ? spreadsheetIdFrom(raw) : null
  const tab = process.env.MML_SHEET_TAB || 'MML'
  const booksTab = process.env.MML_BOOKS_TAB || 'Kitoblar'
  return id ? { id, url: `https://docs.google.com/spreadsheets/d/${id}/edit`, tab, booksTab } : null
}

/**
 * Where the store directory is read from. STORES_SHEET_URL, else the MML
 * sheet, since both live in "Sotuv uchun". Read only — Viewer access is enough.
 */
export function storesSource(): { id: string; url: string; tab: string; gradeTab: string } | null {
  const raw = process.env.STORES_SHEET_URL
    || process.env.MML_SHEET_URL
    || process.env.SHEETS_SPREADSHEET_URL
    || process.env.SHEETS_SPREADSHEET_ID
  const id = raw ? spreadsheetIdFrom(raw) : null
  return id
    ? {
        id,
        url: `https://docs.google.com/spreadsheets/d/${id}/edit`,
        tab: process.env.STORES_SHEET_TAB || "Do'konlar yangi",
        gradeTab: process.env.STORES_GRADE_TAB || "Do'konlar",
      }
    : null
}

const b64url = (s: string | Buffer) =>
  Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

// one entry per scope: the Forms importer asks for a different scope than the
// exporter, and a token minted for one is rejected for the other
const cached = new Map<string, { token: string; expires: number }>()

/** A service-account bearer token for any Google scope. */
export async function googleToken(scope: string): Promise<string> {
  const hit = cached.get(scope)
  if (hit && hit.expires > Date.now() + 60_000) return hit.token

  const { email, key } = credentials()
  const iat = Math.floor(Date.now() / 1000)
  const claim = { iss: email, scope, aud: TOKEN_URL, iat, exp: iat + 3600 }
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`

  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  const jwt = `${unsigned}.${b64url(signer.sign(key))}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`Google token xatosi: ${body.error_description ?? body.error}`)

  cached.set(scope, { token: body.access_token, expires: Date.now() + body.expires_in * 1000 })
  return body.access_token
}

const accessToken = () => googleToken(SCOPE)

async function api(path: string, init?: RequestInit, spreadsheetId?: string) {
  const sheetId = spreadsheetId ?? config().sheetId
  const res = await fetch(`${API}/${sheetId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error?.message ?? `Sheets API ${res.status}`)
  return body
}

/**
 * Replace the visits tabs.
 *
 * There is one tab per region plus the master tab holding every visit — the
 * region heads asked for their own page and nobody wanted to lose the single
 * list. The master tab is the one the configured link points at (by gid), or
 * "vizitlar" when the link names none; a region's tab is found by the code its
 * title starts with ("40 Farg'ona"), see regionTabTitle().
 *
 * Each write clears a whole tab, and the target is a spreadsheet the team works
 * in by hand. So a tab is only overwritten when it is empty or its first cell
 * is `mark` — anything else is somebody's own sheet and is left alone, and the
 * tab is reported back as skipped rather than failing the whole push. One bad
 * tab must not stop the other fourteen from being updated.
 */
export async function writeVisitTabs(
  tabs: Array<{ title: string; rows: (string | number | null)[][] }>,
  mark: string,
  existing?: Array<{ sheetId: number; title: string }>,
): Promise<{ wrote: Record<string, number>; skipped: string[] }> {
  // one metadata read for the whole push, not one per tab — none if the caller has it
  const known = existing ?? await listTabs()

  const missing = tabs.filter((t) => !known.some((e) => e.title === t.title))
  if (missing.length) {
    await api(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: missing.map((t) => ({ addSheet: { properties: { title: t.title } } })),
      }),
    })
  }

  // Every tab's current content in one read. A read per tab cost ~17 of the 60
  // reads Google allows a minute, so two pushes and a check in the same minute
  // were refused with "Quota exceeded".
  const current = await readTabs(tabs.map((t) => t.title))

  const wrote: Record<string, number> = {}
  const skipped: string[] = []
  for (const t of tabs) {
    const range = `'${t.title.replace(/'/g, "''")}'`
    const values: unknown[][] = current.get(t.title) ?? []
    const empty = !values.some((r) => r.some((c) => String(c ?? '').trim() !== ''))
    if (!empty && values[0]?.[0] !== mark) { skipped.push(t.title); continue }
    // Already exactly this — a region nobody visited since the last push, or an
    // emptied one: a clear and a write would change nothing and spend two of
    // the minute's write quota.
    if (sameCells(values, t.rows)) {
      wrote[t.title] = t.rows.length - 1
      continue
    }

    await api(`/values/${encodeURIComponent(range)}:clear`, { method: 'POST', body: '{}' })
    await api(
      `/values/${encodeURIComponent(range + '!A1')}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: t.rows }) },
    )
    wrote[t.title] = t.rows.length - 1
  }
  return { wrote, skipped }
}

/**
 * Several tabs of the export spreadsheet in ONE request. Reading them one by
 * one costs a read per tab, and Google allows 60 a minute — a whole-sheet
 * check that way would starve the push it is checking.
 */
export async function readTabs(titles: string[]): Promise<Map<string, unknown[][]>> {
  if (!titles.length) return new Map()
  const q = titles.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`).join('&')
  // unformatted, so a number comes back as the number the export wrote, not "3,5"
  const body = await api(`/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&${q}`)
  return new Map(titles.map((t, i) => [t, (body.valueRanges?.[i]?.values ?? []) as unknown[][]]))
}

/**
 * Same cells, ignoring what the API leaves out: it drops trailing empty cells
 * of a row and trailing empty rows, where the export writes '' or null.
 */
function sameCells(have: unknown[][], want: unknown[][]): boolean {
  const norm = (rows: unknown[][]) => {
    const out = rows.map((r) => {
      const x = r.map((c) => c ?? '')
      while (x.length && x[x.length - 1] === '') x.pop()
      return x
    })
    while (out.length && !out[out.length - 1].length) out.pop()
    return JSON.stringify(out)
  }
  return norm(have) === norm(want)
}

/** Every tab in the export spreadsheet, in the order the team sees them. */
export async function listTabs(): Promise<Array<{ sheetId: number; title: string }>> {
  const meta = await api('?fields=sheets.properties(sheetId,title)')
  return (meta.sheets ?? []).map((x: any) => x.properties)
}

/**
 * The name of the tab every visit goes to. The gid in the configured link when
 * there is one — that is how the team points the export at a tab they made —
 * otherwise "vizitlar". Pass the tab list when the caller already has it.
 */
export async function masterTabTitle(
  tabs?: Array<{ sheetId: number; title: string }>,
): Promise<string> {
  const target = spreadsheetTarget()
  if (!target?.gid) return 'vizitlar'
  const hit = (tabs ?? await listTabs()).find((t) => String(t.sheetId) === target.gid)
  if (!hit) throw new Error(`Havoladagi varaq (gid=${target.gid}) jadvalda topilmadi`)
  return hit.title
}

/**
 * The tab a region's visits go to.
 *
 * A tab belongs to a region when the number its title starts with IS the
 * region code: "40 Farg'ona", "40-Farg'ona" and "40 Fargona" are all region 40,
 * while "0104 Chilonzor" (a district) and "4 Farg'ona" are not. The words after
 * the code are the team's to rename. Matching on the whole name used to make
 * every rename look like a missing tab, and the next push created a fresh
 * "Farg'ona" beside the renamed one.
 *
 * The master tab never counts, even when its title starts with a code: it holds
 * every visit, and one region's rows written over it would lose the rest. Two
 * tabs with the same code: the first one in the spreadsheet wins. No tab at
 * all: a new one is named "<code> <region>", the way the team names them.
 */
export function regionTabTitle(code: string, name: string, titles: string[], master: string): string {
  const own = titles.find((t) => t !== master && /^\s*(\d+)/.exec(t)?.[1] === code)
  return own ?? `${code} ${name}`
}

/**
 * What is wrong with the configuration, in words, or null if nothing is.
 * A missing key and a mistyped URL are different problems and the admin page
 * has to say which — "sozlanmagan" when the URL is simply wrong sends people
 * looking in the wrong place.
 */
export function sheetsProblem(): string | null {
  try { config(); return null } catch (e) { return (e as Error).message }
}

/**
 * Read a whole tab as rows of strings. Trailing empty cells are omitted by the
 * API, so rows are ragged — callers must index defensively.
 */
export async function readTab(title: string, spreadsheetId?: string): Promise<string[][]> {
  // credentials are still required even when reading someone else's sheet
  credentials()
  const body = await api(`/values/${encodeURIComponent(title)}`, undefined, spreadsheetId)
  return (body.values ?? []) as string[][]
}

export function isConfigured(): boolean {
  return sheetsProblem() === null
}

/** The Forms importer needs the credentials but not the spreadsheet id. */
export function hasServiceAccount(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY)
}
