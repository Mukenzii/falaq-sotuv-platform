/**
 * Command-line version of the "Google Sheets'dan yangilash" button.
 *
 *   npx tsx scripts/import-mml.mjs      (or press the button on /admin/mml)
 *
 * The logic lives in lib/mmlImport.ts so the button and the terminal cannot
 * drift apart — there used to be two copies of the matching rules here.
 */
import { importMmlFromSheet } from '../lib/mmlImport.ts'

const r = await importMmlFromSheet()
console.log(`tab             ${r.tab}`)
console.log(`books matched   ${r.books.matched}/${r.books.total}`)
if (r.books.missing.length) console.log('  not in the books table:  ' + r.books.missing.join(' | '))
console.log(`stores matched  ${r.stores.matched}/${r.stores.total}`)
if (r.stores.missing.length) console.log('  not in the stores table: ' + r.stores.missing.join(' | '))
console.log(`rules           ${r.rules}`)
console.log(`overrides       ${r.overrides} of ${r.cells} cells`)
process.exit(0)
