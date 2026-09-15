/**
 * Command-line version of the "Google Sheets'dan yangilash" button on /dokon.
 *
 *   npx tsx scripts/import-stores.mjs                 read the sheet, apply
 *   npx tsx scripts/import-stores.mjs --dry-run       read the sheet, print the plan only
 *   npx tsx scripts/import-stores.mjs --grids f.json  use {"<tab>": [[...]]} instead of Google
 *
 * --grids exists because the service account may not have access to the sheet
 * yet; the grids can come from any export of it. The logic is lib/storeImport.ts,
 * the same code the button runs.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { planStoreImport, applyStoreImport, readStoreTabs, storeSourceOrThrow } from '../lib/storeImport.ts'

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const gridsAt = args.includes('--grids') ? args[args.indexOf('--grids') + 1] : null

let src, master, graded
if (gridsAt) {
  src = storeSourceOrThrow()
  const grids = JSON.parse(readFileSync(gridsAt, 'utf8'))
  master = grids[src.tab]
  graded = grids[src.gradeTab]
  if (!master || !graded) throw new Error(`tabs "${src.tab}" / "${src.gradeTab}" not in ${gridsAt}`)
} else {
  ;({ src, master, graded } = await readStoreTabs())
}

const plan = planStoreImport(master, graded)
const count = (xs, key) => Object.entries(xs.reduce((a, s) => ((a[s[key] ?? '—'] = (a[s[key] ?? '—'] ?? 0) + 1), a), {}))
  .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(' | ')

console.log(`rows            ${plan.rows.master} in "${src.tab}", ${plan.rows.graded} in "${src.gradeTab}"`)
console.log(`shops           ${plan.stores.length}`)
console.log(`skipped         ${plan.skipped.length}: ${plan.skipped.join(' | ')}`)
console.log(`types           ${count(plan.stores, 'store_type')}`)
console.log(`grades          ${count(plan.stores, 'grade')}`)
console.log(`no territory    ${plan.noTerritory.length}: ${plan.noTerritory.join(' | ')}`)
console.log(`no type         ${plan.noType.length}: ${plan.noType.join(' | ')}`)

if (!dry) {
  const r = await applyStoreImport(plan, src)
  console.log(`inserted        ${r.inserted}`)
  console.log(`updated         ${r.updated}`)
  console.log(`retired         ${r.retired.length}: ${r.retired.join(' | ')}`)
}
process.exit(0)
