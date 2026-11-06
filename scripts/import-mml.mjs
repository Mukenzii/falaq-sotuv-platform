/**
 * Command-line version of the "Google Sheets'dan yangilash" button on /admin/mml.
 *
 *   npx tsx scripts/import-mml.mjs      (or press the button)
 *
 * The logic lives in lib/mmlImport.ts so the button and the terminal cannot
 * drift apart.
 */
import 'dotenv/config'
import { importMmlFromSheet } from '../lib/mmlImport.ts'

const r = await importMmlFromSheet()
console.log(`tabs            ${r.tabs.weights} + ${r.tabs.books}`)
console.log(`columns         ${r.columns.length}`)
console.log(`books           ${r.books.total} (${r.books.matched} matched, ${r.books.created.length} created)`)
if (r.books.aliased.length) console.log('  linked by alias:   ' + r.books.aliased.join(' | '))
if (r.books.created.length) console.log('  created:           ' + r.books.created.join(' | '))
if (r.books.notInSheet.length) console.log('  no longer counted: ' + r.books.notInSheet.join(' | '))
if (r.skipped.length) console.log(`skipped         ${r.skipped.join(' | ')}`)
console.log(`codes           ${r.weights}`)
console.log('per column (1 = required, 2 = optional):')
for (const t of r.targets) {
  console.log(`  ${t.column.padEnd(32)} ${String(t.required).padStart(3)} required${t.optional ? `, ${t.optional} optional` : ''}`)
}
process.exit(0)
