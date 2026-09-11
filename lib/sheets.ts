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

/** The sheet the export is pointed at, for showing on the admin page. */
export function spreadsheetTarget(): { id: string; url: string } | null {
  const raw = process.env.SHEETS_SPREADSHEET_URL || process.env.SHEETS_SPREADSHEET_ID
  const id = raw ? spreadsheetIdFrom(raw) : null
  return id ? { id, url: `https://docs.google.com/spreadsheets/d/${id}/edit` } : null
}

/**
 * Where the must-list is read FROM, which need not be the sheet the visits are
 * written TO. Falls back to the export sheet, which is where it lives today.
 */
export function mmlSource(): { id: string; url: string; tab: string } | null {
  const raw = process.env.MML_SHEET_URL
    || process.env.SHEETS_SPREADSHEET_URL
    || process.env.SHEETS_SPREADSHEET_ID
  const id = raw ? spreadsheetIdFrom(raw) : null
  const tab = process.env.MML_SHEET_TAB || "Do'kon MML"
  return id ? { id, url: `https://docs.google.com/spreadsheets/d/${id}/edit`, tab } : null
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

/** Creates the tab if it isn't there yet, so a fresh spreadsheet just works. */
async function ensureTab(title: string) {
  const meta = await api('?fields=sheets.properties.title')
  const exists = meta.sheets?.some((s: any) => s.properties.title === title)
  if (exists) return
  await api(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  })
}

/** Replaces a tab's contents. Header row first. */
export async function writeTab(title: string, rows: (string | number | null)[][]) {
  await ensureTab(title)
  await api(`/values/${encodeURIComponent(title)}:clear`, { method: 'POST', body: '{}' })
  await api(
    `/values/${encodeURIComponent(title)}!A1?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: rows }) },
  )
  return rows.length - 1
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
