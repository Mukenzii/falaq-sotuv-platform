/**
 * The MML matrix (1 = required, 2 = optional) and the score built on it, with
 * no server, database or network: lib/mmlParse.ts and lib/mml.ts are pure.
 *   node --test tests/mml.test.mjs
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mmlCode, parseMmlSheet } from '../lib/mmlParse.ts'
import { scoreMml } from '../lib/mml.ts'

// the layout of the November 2026 sheet: book rows, a book category, shop columns,
// and the totals row at the bottom
const HEAD = ['№', 'Kitob', 'Kat.', 'Ulgurji savdo\n(Optovik)', "Kitob do'kon (A)", 'Supermarket']
const sheet = (...rows) => [['MML'], HEAD, ...rows, ['', 'ИТОГО', '', '2', '1', '1']]
const codesOf = (parsed, title) => Object.fromEntries(parsed.books.find((b) => b.title === title).codes)

describe('reading the matrix', () => {
  test('1 is required, 2 optional, 0 not required, an empty cell is no code', () => {
    const p = parseMmlSheet(sheet(
      ['1', 'Yusufning qizi', 'A++', '1', '2', '0'],
      ['2', 'Assasin', 'B', '2', '', '1'],
    ), [])
    assert.deepEqual(codesOf(p, 'Yusufning qizi'),
      { 'Ulgurji savdo (Optovik)': 1, "Kitob do'kon (A)": 2, Supermarket: 0 })
    assert.deepEqual(codesOf(p, 'Assasin'), { 'Ulgurji savdo (Optovik)': 2, Supermarket: 1 },
      'an empty cell is left out, not read as 0 or 2')
  })

  test('a 2 is a code, never a quantity or a yes', () => {
    const p = parseMmlSheet(sheet(['1', 'Darbadar', 'A', '2', '2', '2']), [])
    assert.ok(Object.values(codesOf(p, 'Darbadar')).every((c) => c === 2))
  })

  test('the totals row is not a book, and wrapped headers are one line', () => {
    const p = parseMmlSheet(sheet(['1', 'Darbadar', 'A', '1', '1', '1']), [])
    assert.deepEqual(p.books.map((b) => b.title), ['Darbadar'])
    assert.deepEqual(p.columns, ['Ulgurji savdo (Optovik)', "Kitob do'kon (A)", 'Supermarket'])
  })

  test('the book category comes from the matrix', () => {
    const p = parseMmlSheet(sheet(['a', 'Bilsangiz edi', 'New', '1', '1', '0']), [])
    assert.equal(p.books[0].category, 'New')
  })

  test('an old share, a stock count or a typo stops the import, naming the cell', () => {
    for (const bad of ['0,5', '0.3', '3', '5', 'x', '-1']) {
      assert.throws(
        () => parseMmlSheet(sheet(['1', 'Darbadar', 'A', '1', bad, '1']), []),
        (e) => e.message.includes('Darbadar') && e.message.includes("Kitob do'kon (A)") && e.message.includes(bad),
        `"${bad}" must be refused`)
    }
  })

  test('the older layout ("Kitob nomi", "Kategoriya") is still read', () => {
    const p = parseMmlSheet([['№', 'Kitob nomi', 'Kategoriya', 'Supermarket'], ['1', 'Darbadar', 'A', '1']], [])
    assert.deepEqual(codesOf(p, 'Darbadar'), { Supermarket: 1 })
  })

  test('a sheet without the two headers is refused', () => {
    assert.throws(() => parseMmlSheet([['Nomi', 'Turi'], ['Darbadar', '1']], []), /Kitob/)
  })

  test('a title written twice is refused rather than guessed', () => {
    assert.throws(
      () => parseMmlSheet(sheet(['1', 'Darbadar', 'A', '1', '1', '1'], ['2', 'Darbadar', 'A', '2', '2', '2']), []),
      /ikki marta/)
  })

  test('a shop column named twice is refused', () => {
    assert.throws(() => parseMmlSheet([['Kitob', 'Kat.', 'Supermarket', 'Supermarket'], ['Darbadar', 'A', '1', '2']], []),
      /ikki marta/)
  })

  test('Kitoblar adds the titles the matrix leaves out, and fills only an empty category', () => {
    const books = [['№', 'Kitob nomi', 'Kategoriya'], ['1', 'Darbadar', 'C'], ['2', 'Kechir Allohim', 'B'], ['3', 'Ekipaj', 'New']]
    const p = parseMmlSheet(sheet(['1', 'Darbadar', 'A', '1', '1', '1'], ['2', 'Ekipaj', '', '1', '1', '1']), books)
    const cat = Object.fromEntries(p.books.map((b) => [b.title, b.category]))
    assert.equal(cat.Darbadar, 'A', "the matrix's own category wins")
    assert.equal(cat.Ekipaj, 'New', 'an empty Kat. is filled from Kitoblar')
    assert.equal(cat['Kechir Allohim'], 'B')
    assert.equal(p.books.find((b) => b.title === 'Kechir Allohim').codes.size, 0, 'listed, but required nowhere')
  })

  test('mmlCode reads only 0, 1 and 2', () => {
    assert.equal(mmlCode('1'), 1)
    assert.equal(mmlCode(' 2 '), 2)
    assert.equal(mmlCode('0'), 0)
    assert.equal(mmlCode('1,0'), 1)
    assert.equal(mmlCode(''), null)
    assert.equal(mmlCode(null), null)
    assert.equal(mmlCode('0,5'), 'invalid')
    assert.equal(mmlCode('2.5'), 'invalid')
  })
})

describe('scoring a shop', () => {
  const t = (id, kind, bor = false, qolda = false) => ({ book_id: id, title: `T${id}`, book_category: 'A', kind, bor, qolda })
  const shop = [t(1, 'majburiy'), t(2, 'majburiy'), t(3, 'majburiy'), t(4, 'majburiy'), t(5, 'ixtiyoriy'), t(6, 'ixtiyoriy')]

  test('partial: required on the shelf over required', () => {
    const s = scoreMml(shop, new Set([1, 2, 5, 6]))
    assert.equal(s.kerak, 4)
    assert.equal(s.bor, 2)
    assert.equal(s.foiz, 50)
    assert.deepEqual(s.missing.map((x) => x.book_id), [3, 4])
  })

  test('full: every required title, whatever the optional ones', () => {
    const s = scoreMml(shop, new Set([1, 2, 3, 4]))
    assert.equal(s.foiz, 100)
    assert.deepEqual(s.missing, [])
  })

  test('optional titles neither raise nor lower it, and are never missing', () => {
    const none = scoreMml(shop, new Set([1]))
    const all = scoreMml(shop, new Set([1, 5, 6]))
    assert.equal(none.foiz, all.foiz)
    assert.ok(all.missing.every((x) => x.kind === 'majburiy'))
  })

  test('a shop that requires nothing has no MML — not 100%, not 0%', () => {
    const s = scoreMml([t(5, 'ixtiyoriy', true)], new Set([5]))
    assert.equal(s.kerak, 0)
    assert.equal(s.foiz, null)
    assert.deepEqual(s.missing, [])
  })

  test('a hand-set value wins over a tick, either way', () => {
    const rows = [t(1, 'majburiy', false, true), t(2, 'majburiy', true, true)]
    const s = scoreMml(rows, new Set([1]))
    assert.equal(s.bor, 1, 'ticked 1 is hand-set absent; unticked 2 is hand-set present')
    assert.deepEqual(s.missing.map((x) => x.book_id), [1])
  })

  test('a tick counts whether the ids are numbers or strings', () => {
    // /api/books sends "12" (bigint as text), /api/mml/dokon may send either
    const rows = [t('12', 'majburiy'), t(13, 'majburiy')]
    assert.equal(scoreMml(rows, new Set(['12', '13'])).bor, 2)
    assert.equal(scoreMml(rows, new Set([12, 13])).bor, 2)
  })

  test('without ticks it reads what the database says', () => {
    const s = scoreMml([t(1, 'majburiy', true), t(2, 'majburiy', false)])
    assert.equal(s.foiz, 50)
  })

  test('rounds to one decimal the way the database does', () => {
    const rows = [t(1, 'majburiy'), t(2, 'majburiy'), t(3, 'majburiy')]
    assert.equal(scoreMml(rows, new Set([1])).foiz, 33.3)
    assert.equal(scoreMml(rows, new Set([1, 2])).foiz, 66.7)
  })
})
