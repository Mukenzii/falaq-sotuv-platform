/**
 * End-to-end tests against a running dev server and the docker database.
 *   npm test          (docker compose up -d && next dev must be running)
 *
 * Sessions are forged with the same HMAC the app uses, so these exercise the
 * real routes and the real RLS policies, not mocks.
 */
import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import 'dotenv/config'

const BASE = process.env.TEST_BASE ?? 'http://localhost:4300'
const PORT = Number(new URL(BASE).port || 80)
const SECRET = process.env.SESSION_SECRET

function psql(q) {
  return execFileSync('docker', [
    'compose', 'exec', '-T', 'db', 'psql', '-U', 'falaq_owner', '-d', 'falaq', '-tAc', q,
  ], { encoding: 'utf8' }).trim()
}

const cookie = (id) => `falaq_session=${id}.${createHmac('sha256', SECRET).update(id).digest('base64url')}`

async function req(path, { as, method = 'GET', body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    headers: {
      ...(as ? { cookie: cookie(as) } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, json, text, headers: r.headers }
}

const U = {}
let STORE_A, STORE_B, ORIGINAL_OWNERS, SOLO_DIREKTOR

/**
 * The credentials the sign-in tests use. `password` is rewritten as the tests
 * reset and change it, so later tests always sign in with whatever the last
 * one left behind.
 */
const LOGIN = { user: 'sinov.manager', password: '' }

/**
 * Every login the suite creates. The fixture people are found by their
 * 9000009xx telegram ids, but accounts made through the API have no telegram
 * id at all any more — without this list they would survive the run and sit in
 * the real database.
 */
const FIXTURE_LOGINS = ["sinov.manager", "yangi.xodim", "hacker.x", "ismsiz", "parolsiz"]
  .map((u) => `'${u}'`).join(', ')

before(async () => {
  assert.ok(SECRET && !SECRET.startsWith('change_me'), 'SESSION_SECRET must be set in .env')

  // This database holds real people now, and an admin deleting a placeholder
  // through /admin/sozlash is a supported thing to do — so the suite must not
  // depend on any row it did not create itself. Everything below lives in the
  // reserved 9000009xx band and is torn down at the end of the run.
  psql(`delete from visit_books; delete from visits;
        delete from users where telegram_id between 900000100 and 900000999
                             or username in (${FIXTURE_LOGINS});`)

  // The suite creates and deletes visits in the same database the app pushes to
  // Google Sheets from. Without this, every run would spray its fixtures across
  // the real company spreadsheet.
  psql('update sheets_sync set paused = true where id')

  U.komil = psql("select id from users where role = 'direktor' and active order by created_at limit 1")
  // guard_last_direktor only fires when there IS one direktor left. A database
  // with two (a second admin added by hand, which is a normal thing to do) lets
  // the demote through — and the suite would then demote a real person's
  // account and deactivate it, which is exactly what happened on 2026-09-16.
  SOLO_DIREKTOR = psql("select count(*) from users where role = 'direktor' and active") === '1'
  assert.match(U.komil, /^[0-9a-f-]{36}$/, 'the database has no active direktor to test as')

  const add = (tg, name, role, parent) => psql(`with x as (
      insert into users (telegram_id, full_name, role, parent_id)
      values (${tg}, '${name}', '${role}', ${parent ? `'${parent}'` : 'null'}) returning id)
    select id from x`)

  // a disposable org chart: one boss, two region heads, three managers
  U.jasur   = add(900000901, 'Sinov Boshliq',    'sotuv_boshligi', U.komil)
  U.dilshod = add(900000902, 'Sinov Hudud A',    'hudud_rahbari',  U.jasur)
  U.nodira  = add(900000903, 'Sinov Hudud B',    'hudud_rahbari',  U.jasur)
  U.sardor  = add(900000904, 'Sinov Manager A1', 'sotuv_manager',  U.dilshod)
  U.malika  = add(900000905, 'Sinov Manager A2', 'sotuv_manager',  U.dilshod)
  U.otabek  = add(900000906, 'Sinov Manager B1', 'sotuv_manager',  U.nodira)

  // Sardor is the one the sign-in tests actually sign in as, so he needs a
  // real login and a real hash. Made through the API rather than typed into
  // the database, so the test exercises the route an admin uses.
  psql(`update users set username = '${LOGIN.user}' where id = '${U.sardor}'`)

  // borrow two real stores, remembering who owned them so they go back
  const two = psql("select string_agg(id::text, ',' order by id) from (select id from stores where active order by id limit 2) x").split(',')
  ;[STORE_A, STORE_B] = two
  assert.ok(STORE_A && STORE_B, 'the database needs at least two active stores')
  ORIGINAL_OWNERS = psql(`select string_agg(coalesce(quote_literal(owner_id::text), 'null'), ',' order by id)
                            from stores where id in (${STORE_A}, ${STORE_B})`).split(',')
  psql(`update stores set owner_id = '${U.sardor}' where id = ${STORE_A};
        update stores set owner_id = '${U.otabek}' where id = ${STORE_B};`)

  // Issue the fixture password through the route an admin actually presses,
  // rather than writing a hash into the database from here: this way the suite
  // cannot pass while the reset endpoint is broken.
  const issued = await req(`/api/users/${U.sardor}/password`, { as: U.komil, method: 'POST' })
  assert.equal(issued.status, 200, `could not issue a fixture password: ${issued.text}`)
  LOGIN.password = issued.json.password
})

// Give the borrowed stores back and take the fixture people away. Runs last,
// so a failing test still leaves the real data as it was found.
after(() => {
  if (ORIGINAL_OWNERS) {
    psql(`update stores set owner_id = ${ORIGINAL_OWNERS[0]}::uuid where id = ${STORE_A};
          update stores set owner_id = ${ORIGINAL_OWNERS[1]}::uuid where id = ${STORE_B};`)
  }
  psql(`delete from visit_books; delete from visits;
        delete from users where telegram_id between 900000100 and 900000999
                             or username in (${FIXTURE_LOGINS});`)
  // let the real data push again, and ask for one so the sheet matches reality
  psql('update sheets_sync set paused = false, dirty = true where id')
})

/**
 * What is required is now the published form's decision, not the API's, and the
 * seeded form marks most of the 16 originals required. The suite starts from a
 * copy with those relaxed so each test can assert the one rule it is about; the
 * form is put back in the after() hook.
 */
let ORIGINAL_DOC = null   // exactly what was published before the run
let BASELINE_DOC = null   // that, with the suite's own leftovers and requirements removed
const TEST_BLOCK = /^(q_test|q_t_|q_only_on_last|q_branch|q_will_be_deleted|q_broken|i_test|v_test)/

before(async () => {
  // start from the PUBLISHED form, not the draft: a draft can be left mid-edit
  // (or half-broken by a crashed run) and the suite must not inherit that
  const live = (await req('/api/form', { as: U.komil })).json
  ORIGINAL_DOC = structuredClone(live.doc)
  const doc = structuredClone(live.doc)

  // A crashed run can leave its questions and its branching behind, so the
  // baseline is rebuilt rather than inherited: test blocks out, every question
  // relaxed, routing straightened.
  doc.settings.pagination = 'single'
  for (const s of doc.sections) {
    s.next = { type: 'continue' }
    s.blocks = s.blocks.filter((b) => !TEST_BLOCK.test(b.id))
    // nothing is required in the baseline — including questions an admin added
    // outside the suite — so a test that posts a sparse visit is testing what it
    // says it is, and the tests about required-ness turn it on themselves
    for (const b of s.blocks) if (b.kind === 'question') b.required = false
  }
  BASELINE_DOC = structuredClone(doc)

  const d = (await req('/api/form?v=draft', { as: U.komil })).json
  assert.equal((await req('/api/form/draft', { as: U.komil, method: 'PUT', body: { doc, rev: d.rev } })).status, 200)
  const pub = await req('/api/form/publish', { as: U.komil, method: 'POST', body: {} })
  assert.equal(pub.status, 200, JSON.stringify(pub.json))
})

/**
 * Puts the form back to that baseline. Every suite that publishes questions of
 * its own calls this when it is done — otherwise a required question invented
 * by one suite silently fails every visit posted by the next.
 */
async function publishDoc(doc, what) {
  if (!doc) return
  const d = (await req('/api/form?v=draft', { as: U.komil })).json
  await req('/api/form/draft', { as: U.komil, method: 'PUT', body: { doc, rev: d.rev } })
  const r = await req('/api/form/publish', { as: U.komil, method: 'POST', body: {} })
  assert.equal(r.status, 200, `${what} not restored: ${JSON.stringify(r.json)}`)
}

const resetForm = () => publishDoc(BASELINE_DOC, 'baseline')

// the very last thing the run does is hand the real form back untouched
after(() => publishDoc(ORIGINAL_DOC, 'original form'))

describe('auth', () => {
  test('anonymous cannot read /api/me', async () => {
    assert.equal((await req('/api/me')).status, 401)
  })

  test('anonymous is redirected off the home page', async () => {
    const r = await req('/')
    assert.ok([302, 307].includes(r.status), `got ${r.status}`)
  })

  test('a forged cookie with a bad signature is rejected', async () => {
    const r = await fetch(BASE + '/api/me', { headers: { cookie: `falaq_session=${U.komil}.wrong` } })
    assert.equal(r.status, 401)
  })

  test('signing in with a login and password works', async () => {
    const r = await req('/api/auth/login', {
      method: 'POST', body: { login: LOGIN.user, password: LOGIN.password },
    })
    assert.equal(r.status, 200, r.text)
    assert.equal(r.json.ok, true)
    assert.match(r.headers.get('set-cookie') ?? '', /falaq_session=/)
  })

  test('the login is not case sensitive', async () => {
    const r = await req('/api/auth/login', {
      method: 'POST', body: { login: LOGIN.user.toUpperCase(), password: LOGIN.password },
    })
    assert.equal(r.status, 200, r.text)
  })

  test('a wrong password is refused', async () => {
    const r = await req('/api/auth/login', {
      method: 'POST', body: { login: LOGIN.user, password: 'butunlay-boshqa' },
    })
    assert.equal(r.status, 401)
    assert.equal(r.headers.get('set-cookie'), null)
  })

  test('an unknown login gets the same answer as a wrong password', async () => {
    const a = await req('/api/auth/login', { method: 'POST', body: { login: LOGIN.user, password: 'x'.repeat(12) } })
    const b = await req('/api/auth/login', { method: 'POST', body: { login: 'yoq.odam', password: 'x'.repeat(12) } })
    assert.equal(a.status, 401)
    assert.equal(b.status, 401)
    assert.equal(a.json.error, b.json.error, 'the form must not say which accounts exist')
  })

  test('a deactivated account cannot sign in even with the right password', async () => {
    psql(`update users set active = false where id = '${U.sardor}'`)
    try {
      const r = await req('/api/auth/login', {
        method: 'POST', body: { login: LOGIN.user, password: LOGIN.password },
      })
      assert.equal(r.status, 403)
    } finally {
      psql(`update users set active = true where id = '${U.sardor}'`)
    }
  })

  test('the password is never in what the API hands back', async () => {
    const r = await req('/api/users', { as: U.komil })
    assert.equal(r.status, 200)
    assert.ok(!/password_hash|scrypt\$/.test(r.text), 'a hash reached the browser')
    // has_password is a boolean about it, which is fine and is what the admin
    // screen shows
    assert.equal(typeof r.json[0].has_password, 'boolean')
  })

  test('repeated wrong passwords lock the account, and a reset unlocks it', async () => {
    for (let i = 0; i < 8; i++) {
      await req('/api/auth/login', { method: 'POST', body: { login: LOGIN.user, password: 'notit-notit' } })
    }
    const locked = await req('/api/auth/login', {
      method: 'POST', body: { login: LOGIN.user, password: LOGIN.password },
    })
    assert.equal(locked.status, 429, 'the right password should still be refused while locked')

    const reset = await req(`/api/users/${U.sardor}/password`, { as: U.komil, method: 'POST' })
    assert.equal(reset.status, 200, reset.text)
    LOGIN.password = reset.json.password

    const after = await req('/api/auth/login', {
      method: 'POST', body: { login: LOGIN.user, password: LOGIN.password },
    })
    assert.equal(after.status, 200, after.text)
    assert.equal(after.json.next, '/parol', 'a reset password has to be replaced on arrival')
  })

})

describe("passwords are an administrator's job", () => {
  test("a manager cannot reset somebody else's password", async () => {
    const r = await req(`/api/users/${U.malika}/password`, { as: U.sardor, method: 'POST' })
    assert.equal(r.status, 403)
  })

  test('a manager cannot make their own account an admin', async () => {
    const r = await req(`/api/users/${U.sardor}`, {
      as: U.sardor, method: 'PATCH', body: { role: 'direktor' },
    })
    assert.ok([403, 409].includes(r.status), `got ${r.status}: ${r.text}`)
    assert.equal(psql(`select role from users where id = '${U.sardor}'`), 'sotuv_manager')
  })

  test("a manager cannot take over somebody else's login", async () => {
    const r = await req(`/api/users/${U.sardor}`, {
      as: U.sardor, method: 'PATCH', body: { username: 'sinov.boshqa' },
    })
    assert.ok([403, 409].includes(r.status), `got ${r.status}: ${r.text}`)
  })

  test('a manager may still fix their own name', async () => {
    const r = await req(`/api/users/${U.sardor}`, {
      as: U.sardor, method: 'PATCH', body: { full_name: 'Sinov Manager A1' },
    })
    assert.equal(r.status, 200, r.text)
  })

  test('changing your own password needs the old one', async () => {
    const bad = await req('/api/auth/password', {
      as: U.sardor, method: 'POST', body: { current: 'not-the-one', next: 'yangi-parol-123' },
    })
    assert.equal(bad.status, 403)

    const ok = await req('/api/auth/password', {
      as: U.sardor, method: 'POST', body: { current: LOGIN.password, next: 'yangi-parol-123' },
    })
    assert.equal(ok.status, 200, ok.text)
    LOGIN.password = 'yangi-parol-123'

    // and the flag that forced them here is gone
    assert.equal(psql(`select must_change_password from users where id = '${U.sardor}'`), 'f')
  })

  test('a too-short password is refused', async () => {
    const r = await req('/api/auth/password', {
      as: U.sardor, method: 'POST', body: { current: LOGIN.password, next: 'qisqa' },
    })
    assert.equal(r.status, 400)
  })

})

describe('hierarchy visibility', () => {
  test('a sotuv_manager sees only themselves', async () => {
    const r = await req('/api/users', { as: U.sardor })
    assert.equal(r.status, 200)
    assert.equal(r.json.length, 1)
    assert.equal(r.json[0].full_name, 'Sinov Manager A1')
  })

  test('a hudud_rahbari sees themselves plus their two managers', async () => {
    const r = await req('/api/users', { as: U.dilshod })
    assert.equal(r.json.length, 3)
    assert.ok(r.json.every((u) => u.full_name !== 'Sinov Manager B1'), 'other branch leaked')
  })

  test('the direktor sees everyone', async () => {
    const r = await req('/api/users', { as: U.komil })
    // however many real people exist alongside the fixtures
    assert.equal(r.json.length, Number(psql('select count(*) from users')))
  })

  test('every signed-in person sees every store', async () => {
    // Territory was removed on 2026-09-11: shops belong to nobody, and the
    // weekly plan says who should visit what. s_read is now "signed in".
    const all = Number(psql('select count(*) from stores where active'))
    assert.equal((await req('/api/stores', { as: U.komil })).json.length, all)
    assert.equal((await req('/api/stores', { as: U.sardor })).json.length, all)
    assert.equal((await req('/api/stores')).status, 500)  // but not anonymously
  })

  test('books are shared, not scoped', async () => {
    assert.equal((await req('/api/books', { as: U.sardor })).json.length,
                 Number(psql('select count(*) from books where active')))
  })

  test('a manager may only log a visit to a shop that is theirs', async () => {
    // db/25 put the shop check back: one region per person, and the shops in
    // it are theirs. STORE_A is sardor's, STORE_B is otabek's.
    const ok = await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(STORE_A) },
    })
    assert.equal(ok.status, 201)

    const notMine = await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(STORE_B) },
    })
    assert.equal(notMine.status, 403, 'a shop belonging to someone else was accepted')
    assert.match(notMine.json.error, /biriktirilmagan/)
    assert.equal(psql(`select count(*) from visits where store_id = ${STORE_B}`), '0')
  })

  test('the shop check is the database\'s, not only the route\'s', () => {
    // the route answers 403 first so the message can name the shop, but the
    // policy has to stand on its own — a bug in the route must not open it up
    assert.throws(() => psql(`begin;
      select set_config('app.user_id', '${U.sardor}', true);
      set local role falaq_app;
      insert into visits (manager_id, store_id) values ('${U.sardor}', ${STORE_B});
      rollback;`), /row-level security|violates/i)
  })

  test('manager_id still comes from the session, never the body', async () => {
    const forged = await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(STORE_A), manager_id: U.otabek },
    })
    assert.equal(forged.status, 201)
    assert.equal(psql(`select count(*) from visits where manager_id = '${U.otabek}'`), '0',
      'manager_id must still come from the session, never the body')
  })

  test('the auto plan lists stores that are overdue', async () => {
    const r = await req('/api/stores?reja=1', { as: U.sardor })
    assert.ok(r.json.length > 0)
    assert.ok(r.json.every((s) => s.kun_otdi >= 14))
  })
})

describe('user management', () => {
  test('a manager cannot create a user', async () => {
    const r = await req('/api/users', {
      as: U.sardor, method: 'POST',
      body: { username: 'hacker.x', password: 'parol-parol', full_name: 'Hacker' },
    })
    assert.equal(r.status, 403)
  })

  test('the direktor can create a user', async () => {
    const r = await req('/api/users', {
      as: U.komil, method: 'POST',
      body: {
        username: 'yangi.xodim', password: 'parol-parol', full_name: 'Yangi Xodim',
        role: 'sotuv_manager', parent_id: U.dilshod,
      },
    })
    assert.equal(r.status, 201, r.text)
    assert.equal(r.json.full_name, 'Yangi Xodim')
    assert.equal(r.json.username, 'yangi.xodim')
  })

  test('a new account can sign in straight away, and must change its password', async () => {
    const r = await req('/api/auth/login', {
      method: 'POST', body: { login: 'yangi.xodim', password: 'parol-parol' },
    })
    assert.equal(r.status, 200, r.text)
    assert.equal(r.json.next, '/parol')
  })

  test('a duplicate login is a conflict, not a crash', async () => {
    const r = await req('/api/users', {
      as: U.komil, method: 'POST',
      body: { username: 'YANGI.XODIM', password: 'parol-parol', full_name: 'Takror' },
    })
    assert.equal(r.status, 409, 'case must not let a login be taken twice')
  })

  test('creating a user without a name is rejected', async () => {
    const r = await req('/api/users', {
      as: U.komil, method: 'POST', body: { username: 'ismsiz', password: 'parol-parol' },
    })
    assert.equal(r.status, 400)
  })

  test('creating a user without a password is rejected', async () => {
    const r = await req('/api/users', {
      as: U.komil, method: 'POST', body: { username: 'parolsiz', full_name: 'Parolsiz' },
    })
    assert.equal(r.status, 400)
  })

  test('a login with a space in it is rejected', async () => {
    const r = await req('/api/users', {
      as: U.komil, method: 'POST',
      body: { username: 'bir ikki', password: 'parol-parol', full_name: 'Bosh joy' },
    })
    assert.equal(r.status, 400)
  })

  test('the direktor can rename someone', async () => {
    const id = psql("select id from users where username = 'yangi.xodim'")
    const r = await req(`/api/users/${id}`, { as: U.komil, method: 'PATCH', body: { full_name: 'Nomi O\'zgardi' } })
    assert.equal(r.status, 200)
    assert.equal(r.json.full_name, "Nomi O'zgardi")
  })

  test('a manager cannot edit someone in another branch', async () => {
    const r = await req(`/api/users/${U.otabek}`, { as: U.sardor, method: 'PATCH', body: { full_name: 'X' } })
    assert.equal(r.status, 404)
  })

  test('the direktor cannot delete themselves', async () => {
    assert.equal((await req(`/api/users/${U.komil}`, { as: U.komil, method: 'DELETE' })).status, 404)
  })

  test('the last direktor cannot be demoted', { skip: !SOLO_DIREKTOR && 'more than one active direktor' }, async () => {
    const r = await req(`/api/users/${U.komil}`, { as: U.komil, method: 'PATCH', body: { role: 'sotuv_manager' } })
    assert.equal(r.status, 409)
    assert.match(r.json.error, /direktor/)
  })

  test('the last direktor cannot be deactivated', { skip: !SOLO_DIREKTOR && 'more than one active direktor' }, async () => {
    const r = await req(`/api/users/${U.komil}`, { as: U.komil, method: 'PATCH', body: { active: false } })
    assert.equal(r.status, 409)
  })

  test('the direktor can delete a user who has no visits', async () => {
    const id = psql("select id from users where username = 'yangi.xodim'")
    assert.equal((await req(`/api/users/${id}`, { as: U.komil, method: 'DELETE' })).status, 200)
  })
})

describe('visits', () => {
  test('a visit with only a store saves', async () => {
    const r = await req('/api/visits', { as: U.sardor, method: 'POST', body: { store_id: Number(STORE_A) } })
    assert.equal(r.status, 201)
  })

  test('a fully populated visit saves and computes area', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: {
        store_id: Number(STORE_A), width_m: 7, height_m: 6, facing: 'face',
        placement: ["Kirish yo'lida / vitrinada", "O'ng tomonda"],
        shelf_heights: ["Ko'z darajasida"],
        visit_result: ['Kirdim / Taklif berdim', 'Buyurtma oldim'],
        debt_status: "Qarz yo'q", cash_collected: 1500000,
        present_book_ids: [1, 2, 3, 4, 5], stale_book_ids: [6, 7], note: 'test',
      },
    })
    assert.equal(r.status, 201)
    assert.equal(r.json.took_order, true)
    assert.equal(psql("select round(area_m2) from visits where width_m = 7"), '42')
  })

  test('book rows are written for both statuses', async () => {
    assert.equal(psql("select count(*) from visit_books where status='present'"), '5')
    assert.equal(psql("select count(*) from visit_books where status='stale'"), '2')
  })

  test('a visit with no store is rejected', async () => {
    assert.equal((await req('/api/visits', { as: U.sardor, method: 'POST', body: {} })).status, 400)
  })

  test('a manager cannot log a visit under another manager', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      // own store, so only the manager_id claim is under test here
      body: { store_id: Number(STORE_A), manager_id: U.otabek },
    })
    // manager_id is taken from the session, never the body
    assert.equal(r.status, 201)
    assert.equal(psql(`select count(*) from visits where manager_id = '${U.otabek}'`), '0')
  })

  test('managers in different branches cannot see each other', async () => {
    await req('/api/visits', { as: U.otabek, method: 'POST', body: { store_id: Number(STORE_B) } })
    const sardor = await req('/api/visits', { as: U.sardor })
    const otabek = await req('/api/visits', { as: U.otabek })
    assert.ok(sardor.json.every((v) => v.manager === 'Sinov Manager A1'))
    assert.ok(otabek.json.every((v) => v.manager === 'Sinov Manager B1'))
  })

  test('a hudud_rahbari sees their own branch only', async () => {
    const r = await req('/api/visits', { as: U.dilshod })
    assert.ok(r.json.length > 0)
    assert.ok(r.json.every((v) => v.manager === 'Sinov Manager A1'), 'other branch leaked')
  })

  test('the direktor sees every branch', async () => {
    const r = await req('/api/visits', { as: U.komil })
    const names = new Set(r.json.map((v) => v.manager))
    assert.ok(names.has('Sinov Manager A1') && names.has('Sinov Manager B1'))
  })
})

describe('pages render', () => {
  for (const [path, needle] of [
    ['/', 'Falaq Sotuv'],
    ['/vizit/yangi', 'Yangi vizit'],
    ['/admin/users', 'Xodimlar'],
  ]) {
    test(`${path} renders for the direktor`, async () => {
      const r = await req(path, { as: U.komil })
      assert.equal(r.status, 200)
      assert.ok(r.text.includes(needle), `missing "${needle}"`)
    })
  }

  test('/login renders anonymously', async () => {
    const r = await req('/login')
    assert.equal(r.status, 200)
  })
})

describe('google sheets export', () => {
  test('anonymous cannot reach the sync endpoint', async () => {
    assert.equal((await req('/api/sync/sheets')).status, 500) // requireUserId throws
  })

  test('status reports counts and whether credentials are present', async () => {
    const r = await req('/api/sync/sheets', { as: U.komil })
    assert.equal(r.status, 200)
    assert.equal(typeof r.json.configured, 'boolean')
    assert.ok(Number(r.json.visits) >= 0)
  })

  test('a push says what stopped it instead of crashing', async () => {
    // three legitimate outcomes: no credentials, paused for the test run, or
    // it actually ran. Never a 500.
    const r = await req('/api/sync/sheets', { as: U.komil, method: 'POST' })
    assert.ok([200, 409, 503].includes(r.status), `got ${r.status}`)
    if (r.status === 503) assert.match(r.json.error, /sozlanmagan/i)
    if (r.status === 409) assert.match(r.json.error, /to‘xtatilgan|kuting/)
    if (r.status === 200) assert.ok(r.json.ok)
  })

  test('the sheets page renders for the direktor', async () => {
    const r = await req('/admin/sheets', { as: U.komil })
    assert.equal(r.status, 200)
    assert.ok(r.text.includes('Google Sheets'))
  })
})

describe('photo upload', () => {
  test('anonymous cannot get an upload link', async () => {
    assert.equal((await req('/api/uploads/presign', { method: 'POST', body: { contentType: 'image/jpeg' } })).status, 500)
  })

  test('a manager gets a presigned PUT url and a server-chosen key', async () => {
    const r = await req('/api/uploads/presign', {
      as: U.sardor, method: 'POST', body: { contentType: 'image/jpeg', bytes: 1000 },
    })
    assert.equal(r.status, 200)
    assert.match(r.json.objectKey, /^\d{4}\/\d{2}\/[0-9a-f-]{36}\/0\.jpg$/)
    assert.match(r.json.url, /X-Amz-Signature=/)
  })

  test('a non-image type is rejected', async () => {
    const r = await req('/api/uploads/presign', {
      as: U.sardor, method: 'POST', body: { contentType: 'application/pdf' },
    })
    assert.equal(r.status, 400)
  })

  test('an oversized file is rejected before it uploads', async () => {
    const r = await req('/api/uploads/presign', {
      as: U.sardor, method: 'POST', body: { contentType: 'image/jpeg', bytes: 20 * 1024 * 1024 },
    })
    assert.equal(r.status, 413)
  })

  test('bytes actually upload and the photo attaches to the visit', async () => {
    const p = await req('/api/uploads/presign', {
      as: U.sardor, method: 'POST', body: { contentType: 'image/jpeg', bytes: 160 },
    })
    const put = await fetch(p.json.url, {
      method: 'PUT', body: Buffer.from('ffd8ffe000104a464946', 'hex'),
      headers: { 'content-type': 'image/jpeg' },
    })
    assert.equal(put.status, 200)

    const v = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), photos: [{ object_key: p.json.objectKey, content_type: 'image/jpeg', bytes: 10 }] },
    })
    assert.equal(v.status, 201)
    assert.equal(psql(`select count(*) from visit_photos where object_key = '${p.json.objectKey}'`), '1')
    return p.json.objectKey
  })

  test('a photo key not attached to any visit is not viewable', async () => {
    const p = await req('/api/uploads/presign', {
      as: U.sardor, method: 'POST', body: { contentType: 'image/jpeg', bytes: 160 },
    })
    const r = await req(`/api/uploads/view?key=${encodeURIComponent(p.json.objectKey)}`, { as: U.sardor })
    assert.equal(r.status, 404)
  })

  test('another branch cannot view a photo through the view route', async () => {
    const key = psql("select object_key from visit_photos order by created_at desc limit 1")
    const mine = await req(`/api/uploads/view?key=${encodeURIComponent(key)}`, { as: U.sardor })
    assert.ok([302, 307].includes(mine.status), `owner got ${mine.status}`)
    const theirs = await req(`/api/uploads/view?key=${encodeURIComponent(key)}`, { as: U.otabek })
    assert.equal(theirs.status, 404)
  })

  test('the visit list reports how many photos each visit has', async () => {
    const r = await req('/api/visits', { as: U.sardor })
    assert.ok(r.json.some((v) => Number(v.n_photos) > 0))
  })
})

describe('google form parity', () => {
  test('every book in the form picker exists', async () => {
    // The list started as the Google Form's 46 titles and now grows from the
    // "Sotuv uchun" sheet, so: never fewer than the form had, and the picker
    // offers every active book.
    const active = Number(psql('select count(*) from books where active'))
    assert.ok(active >= 46, `only ${active} active books`)
    const r = await req('/api/books', { as: U.sardor })
    assert.equal(r.status, 200)
    assert.equal(r.json.length, active)
  })

  test('the fourth facing answer is a valid enum value', async () => {
    const labels = psql("select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'visit_facing'")
    assert.equal(labels, 'face,qisman_face,koreshok,qutida')
  })

  test('a visit using only the newly added options saves', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: {
        store_id: Number(STORE_A),
        facing: 'qutida',
        placement: ['Kassa yonida', 'Orqa tomonda'],
        shelf_heights: ["Ko'z darajasidan yuqori (160+ sm)"],
        visit_result: ["Do'kon yopiq edi"],
        no_order_reason: 'Narx qimmat deb hisoblaydi',
        debt_status: "Bugun to'ladi",
      },
    })
    assert.equal(r.status, 201)
    assert.equal(r.json.took_order, false)
  })

  test('an unknown facing value is still rejected by the enum', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), facing: 'nonsense' },
    })
    assert.notEqual(r.status, 201)
  })
})

describe('numbers cannot go negative', () => {
  test('a negative width is rejected', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), width_m: -29.5, height_m: -30.5 },
    })
    assert.equal(r.status, 400)
    assert.match(r.json.error, /Eni/)
  })

  test('zero is rejected too — a shop has a size', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(STORE_A), width_m: 0 },
    })
    assert.equal(r.status, 400)
  })

  test('negative cash collected is rejected', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(STORE_A), cash_collected: -5000 },
    })
    assert.equal(r.status, 400)
  })

  test('a comma decimal from a local keyboard is understood, not dropped', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(STORE_A), width_m: '7,5', height_m: '6' },
    })
    assert.equal(r.status, 201)
  })

  test('sizes stay optional', async () => {
    const r = await req('/api/visits', { as: U.sardor, method: 'POST', body: { store_id: Number(STORE_A) } })
    assert.equal(r.status, 201)
  })

  test('the database refuses a negative row even without the API', () => {
    let threw = false
    try {
      psql(`insert into visits (manager_id, store_id, width_m) values ('${U.sardor}', ${STORE_A}, -1)`)
    } catch { threw = true }
    assert.ok(threw, 'check constraint did not fire')
  })
})

describe('store and visit detail', () => {
  test('the store list renders the whole network for everyone', async () => {
    // since territory was dropped, a manager and the direktor see the same
    // shops; what differs is whose VISITS they can see, which is tested above
    const mine = await req('/dokon', { as: U.sardor })
    const all = await req('/dokon', { as: U.komil })
    assert.equal(mine.status, 200)
    const count = (t) => new Set((t.match(/\/dokon\/\d+/g) ?? [])).size
    assert.ok(count(mine.text) > 0, 'manager saw no stores')
    assert.equal(count(mine.text), count(all.text))
  })

  test('a store detail page renders its history', async () => {
    const id = psql(`select store_id from visits limit 1`)
    const r = await req(`/dokon/${id}`, { as: U.komil })
    assert.equal(r.status, 200)
    assert.ok(r.text.includes('Vizitlar tarixi'))
  })

  test('a visit detail page renders', async () => {
    const id = psql(`select id from visits where manager_id = '${U.sardor}' limit 1`)
    const r = await req(`/vizit/${id}`, { as: U.sardor })
    assert.equal(r.status, 200)
    assert.ok(r.text.includes('Natija'))
  })

  test("another branch gets 404 on someone else's visit, not their data", async () => {
    const id = psql(`select id from visits where manager_id = '${U.sardor}' limit 1`)
    const r = await req(`/vizit/${id}`, { as: U.otabek })
    assert.equal(r.status, 404)
  })

  test('an invented visit id is 404', async () => {
    const r = await req('/vizit/11111111-1111-1111-1111-111111111111', { as: U.komil })
    assert.equal(r.status, 404)
  })

  test('/vizit/yangi still wins over the dynamic route', async () => {
    const r = await req('/vizit/yangi', { as: U.sardor })
    assert.equal(r.status, 200)
    assert.ok(r.text.includes('Yangi vizit'))
  })
})

describe('access from another device on the wifi', () => {
  const lanHost = `192.168.0.100:${PORT}`

  // fetch() drops a Host header, so these go through raw http
  const raw = (path, host, method = 'GET') => new Promise((resolve, reject) => {
    import('node:http').then(({ default: http }) => {
      const rq = http.request(
        { host: '127.0.0.1', port: PORT, path, method, headers: { host } },
        (res) => { res.resume(); resolve({ status: res.statusCode, location: res.headers.location }) },
      )
      rq.on('error', reject)
      rq.end()
    })
  })

  test('an upload link is signed for the host that asked for it', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/uploads/presign`, {
      method: 'POST',
      headers: { cookie: cookie(U.komil), 'content-type': 'application/json', host: lanHost },
      body: JSON.stringify({ contentType: 'image/jpeg', bytes: 100 }),
    })
    const j = await r.json()
    // node fetch drops the host header, so this asserts the localhost case holds
    assert.match(j.url, /^http:\/\/[^/]+:9000\/falaq-photos\//)
  })
})

describe('every page is gated server-side', () => {
  // A client component cannot gate itself: logged out it renders an empty shell
  // whose fetches all 401. Each of these must redirect instead.
  for (const path of ['/', '/vizit/yangi', '/dokon', '/admin/hisobot', '/admin/savollar', '/admin/users']) {
    test(`${path} redirects when logged out`, async () => {
      const r = await req(path)
      assert.ok([302, 307].includes(r.status), `${path} returned ${r.status}`)
    })
  }

  test('/login stays reachable', async () => {
    assert.equal((await req('/login')).status, 200)
  })
})

describe('form builder', () => {
  after(resetForm)

  let draft, published0
  const Q = {}          // ids of the questions these tests create

  const getDraft = async () => (await req('/api/form?v=draft', { as: U.komil })).json
  const save = async (doc, rev, as = U.komil) =>
    req('/api/form/draft', { as, method: 'PUT', body: { doc, rev } })
  const publish = async (as = U.komil) => req('/api/form/publish', { as, method: 'POST', body: {} })

  const lastSection = (doc) => doc.sections[doc.sections.length - 1]
  const addQuestion = (doc, q) => {
    lastSection(doc).blocks.push(q)
    return doc
  }

  before(async () => {
    await resetForm()
    published0 = (await req('/api/form', { as: U.komil })).json.version
    draft = await getDraft()
  })

  test('any signed-in user reads the published form', async () => {
    const r = await req('/api/form', { as: U.sardor })
    assert.equal(r.status, 200)
    const questions = r.json.doc.sections.flatMap((s) => s.blocks).filter((b) => b.kind === 'question')
    assert.equal(questions.filter((q) => q.coreKey).length, 16, 'all 16 core questions must survive')
    assert.ok(questions.some((q) => q.coreKey === 'facing'))
  })

  test('a manager cannot read the draft', async () => {
    assert.equal((await req('/api/form?v=draft', { as: U.sardor })).status, 403)
  })

  test('a manager cannot save the draft', async () => {
    const r = await save(draft.doc, draft.rev, U.sardor)
    assert.equal(r.status, 403)
  })

  test('a manager cannot publish', async () => {
    assert.equal((await publish(U.sardor)).status, 403)
  })

  test('the direktor can save a draft, and rev advances', async () => {
    const doc = structuredClone(draft.doc)
    Q.choice = 'q_test_choice'
    addQuestion(doc, {
      id: Q.choice, kind: 'question', type: 'multiple_choice',
      title: 'Raqobatchi kitoblari bormi?', required: false, hidden: false,
      options: [{ id: 'o_a', label: 'Ha' }, { id: 'o_b', label: "Yo'q" }],
    })
    const r = await save(doc, draft.rev)
    assert.equal(r.status, 200)
    assert.notEqual(r.json.rev, draft.rev)
    draft = await getDraft()
  })

  test('a stale rev is a conflict, not a silent overwrite', async () => {
    const doc = structuredClone(draft.doc)
    doc.title = 'Boshqa admin yozdi'
    const r = await save(doc, '1')
    assert.equal(r.status, 409)
    assert.ok(r.json.conflict)
    assert.ok(r.json.server?.doc, 'the other version must come back with the refusal')
  })

  test('the 16 core questions cannot be dropped', async () => {
    const doc = structuredClone(draft.doc)
    for (const s of doc.sections) s.blocks = s.blocks.filter((b) => b.coreKey !== 'facing')
    await save(doc, draft.rev)
    const r = await publish()
    assert.equal(r.status, 422)
    assert.ok(r.json.issues.some((i) => i.message.includes('facing')))
    // put it back
    await save(draft.doc, (await getDraft()).rev)
    draft = await getDraft()
  })

  test("a core question's type cannot be changed through the API", async () => {
    const doc = structuredClone(draft.doc)
    for (const s of doc.sections) {
      for (const b of s.blocks) if (b.coreKey === 'facing') b.type = 'file_upload'
    }
    await save(doc, draft.rev)
    const after = await getDraft()
    const facing = after.doc.sections.flatMap((s) => s.blocks).find((b) => b.coreKey === 'facing')
    assert.equal(facing.type, 'multiple_choice', 'the server must pin a core question to its column')
    draft = after
  })

  test('an empty option list blocks publishing', async () => {
    const doc = structuredClone(draft.doc)
    addQuestion(doc, {
      id: 'q_broken', kind: 'question', type: 'checkboxes',
      title: 'Bo‘sh', required: false, hidden: false, options: [],
    })
    await save(doc, draft.rev)
    const r = await publish()
    assert.equal(r.status, 422)
    assert.ok(r.json.issues.some((i) => i.message.includes('variant')))

    doc.sections[doc.sections.length - 1].blocks =
      lastSection(doc).blocks.filter((b) => b.id !== 'q_broken')
    await save(doc, (await getDraft()).rev)
    draft = await getDraft()
  })

  test('a routing loop blocks publishing', async () => {
    const doc = structuredClone(draft.doc)
    doc.sections[0].next = { type: 'goto', sectionId: doc.sections[1].id }
    doc.sections[1].next = { type: 'goto', sectionId: doc.sections[0].id }
    await save(doc, draft.rev)
    const r = await publish()
    assert.equal(r.status, 422)
    assert.ok(r.json.issues.some((i) => i.message.includes('aylanma')), JSON.stringify(r.json.issues))

    doc.sections[0].next = { type: 'continue' }
    doc.sections[1].next = { type: 'continue' }
    await save(doc, (await getDraft()).rev)
    draft = await getDraft()
  })

  test('publishing makes a new version and leaves the old one readable', async () => {
    const r = await publish()
    assert.equal(r.status, 200)
    assert.ok(r.json.published > published0 - 1)
    const live = (await req('/api/form', { as: U.sardor })).json
    assert.ok(live.doc.sections.flatMap((s) => s.blocks).some((b) => b.id === Q.choice))
    assert.equal(
      (await req(`/api/form?v=${published0}`, { as: U.komil })).status, 200,
      'the superseded version must still be fetchable',
    )
    draft = await getDraft()
  })

  test('an answer to the new question is stored against its block id', async () => {
    const v = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), answers: { [Q.choice]: 'Ha' } },
    })
    assert.equal(v.status, 201)
    assert.equal(psql(`select value #>> '{}' from visit_answers where block_key = '${Q.choice}'`), 'Ha')
    assert.equal(psql(`select form_version from visits where id = '${v.json.id}'`),
      String((await req('/api/form', { as: U.komil })).json.version))
  })

  test('an answer to a question the form does not ask is refused', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), answers: { q_not_a_question: 'x' } },
    })
    assert.equal(r.status, 400)
  })

  test('an option that is not on the list is refused', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), answers: { [Q.choice]: 'Balki' } },
    })
    assert.equal(r.status, 400)
  })

  test('the new question is charted on the summary page', async () => {
    const r = await req('/admin/savollar', { as: U.komil })
    assert.equal(r.status, 200)
    assert.ok(r.text.includes('Raqobatchi kitoblari bormi?'), 'question missing from the summary')
  })

  test('the new question has a column in the CSV export', async () => {
    const r = await req('/api/export/csv', { as: U.komil })
    assert.equal(r.status, 200)
    const [header] = r.text.split('\r\n')
    assert.ok(header.includes('Raqobatchi kitoblari bormi?'), header)
    assert.ok(r.text.split('\r\n').slice(1).some((l) => l.includes(',Ha')), 'the answer is missing')
  })

  test('the answer shows on the individual response', async () => {
    const id = psql(`select visit_id from visit_answers where block_key = '${Q.choice}' limit 1`)
    const r = await req(`/vizit/${id}`, { as: U.komil })
    assert.equal(r.status, 200)
    assert.ok(r.text.includes('Raqobatchi kitoblari bormi?'))
  })

  test('marking a core question required is enforced by the server too', async () => {
    const flip = async (required) => {
      const d = await getDraft()
      const doc = structuredClone(d.doc)
      for (const s of doc.sections) {
        for (const b of s.blocks) if (b.coreKey === 'note') b.required = required
      }
      assert.equal((await save(doc, d.rev)).status, 200)
      assert.equal((await publish()).status, 200)
    }

    await flip(true)
    const bad = await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(STORE_A) },
    })
    assert.equal(bad.status, 400)
    assert.match(bad.json.error, /Shikoyat/)

    await flip(false)
    const good = await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(STORE_A) },
    })
    assert.equal(good.status, 201)
  })
})

describe('question types', () => {
  after(resetForm)

  const ID = {
    scale: 'q_t_scale', rating: 'q_t_rating', grid: 'q_t_grid',
    date: 'q_t_date', time: 'q_t_time', num: 'q_t_num',
    drop: 'q_t_drop', req: 'q_t_req',
  }
  let visitId

  before(async () => {
    await resetForm()
    const d = (await req('/api/form?v=draft', { as: U.komil })).json
    const doc = structuredClone(d.doc)
    const s = doc.sections[doc.sections.length - 1]
    s.blocks.push(
      { id: ID.scale, kind: 'question', type: 'linear_scale', title: 'Shkala', required: false, hidden: false,
        scale: { min: 1, max: 5, minLabel: 'yomon', maxLabel: 'zo‘r' } },
      { id: ID.rating, kind: 'question', type: 'rating', title: 'Baho', required: false, hidden: false,
        rating: { max: 5, icon: 'star' } },
      { id: ID.grid, kind: 'question', type: 'grid_radio', title: 'Jadval', required: false, hidden: false,
        grid: { rows: [{ id: 'r1', label: 'Narx' }], cols: [{ id: 'c1', label: 'Yaxshi' }, { id: 'c2', label: 'Yomon' }] } },
      { id: ID.date, kind: 'question', type: 'date', title: 'Sana', required: false, hidden: false },
      { id: ID.time, kind: 'question', type: 'time', title: 'Vaqt', required: false, hidden: false },
      { id: ID.num, kind: 'question', type: 'short_answer', title: 'Nechta', required: false, hidden: false,
        validation: { kind: 'integer', min: 0, max: 100 } },
      { id: ID.drop, kind: 'question', type: 'dropdown', title: 'Kanal', required: false, hidden: false,
        options: [{ id: 'dc1', label: 'Do‘kon' }, { id: 'dc2', label: 'Bozor' }] },
      { id: ID.req, kind: 'question', type: 'short_answer', title: 'Majburiy izoh', required: true, hidden: false },
    )
    assert.equal((await req('/api/form/draft', { as: U.komil, method: 'PUT', body: { doc, rev: d.rev } })).status, 200)
    assert.equal((await req('/api/form/publish', { as: U.komil, method: 'POST', body: {} })).status, 200)
  })

  test('every type round-trips through validation and storage', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: {
        store_id: Number(STORE_A),
        answers: {
          [ID.scale]: 4,
          [ID.rating]: 5,
          [ID.grid]: { r1: 'Yaxshi' },
          [ID.date]: '2026-09-09',
          [ID.time]: '14:30',
          [ID.num]: '42',
          [ID.drop]: 'Bozor',
          [ID.req]: 'bor',
        },
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.json))
    visitId = r.json.id
    assert.equal(psql(`select count(*) from visit_answers where visit_id = '${visitId}'`), '8')
  })

  test('a required question is enforced by the server, not just the browser', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), answers: { [ID.scale]: 3 } },
    })
    assert.equal(r.status, 400)
    assert.match(r.json.error, /Majburiy izoh/)
  })

  test('a scale value outside its bounds is refused', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), answers: { [ID.scale]: 9, [ID.req]: 'bor' } },
    })
    assert.equal(r.status, 400)
  })

  test('a validation rule on a short answer is enforced', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), answers: { [ID.num]: '999', [ID.req]: 'bor' } },
    })
    assert.equal(r.status, 400)
  })

  test('an unknown grid column is refused', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), answers: { [ID.grid]: { r1: 'Boshqa' }, [ID.req]: 'bor' } },
    })
    assert.equal(r.status, 400)
  })

  test('every type reaches the export with a readable value', async () => {
    const r = await req('/api/export/csv', { as: U.komil })
    const lines = r.text.split('\r\n')
    assert.ok(lines[0].includes('Jadval') && lines[0].includes('Shkala'), lines[0])
    assert.ok(lines.slice(1).some((l) => l.includes('Narx: Yaxshi')), 'a grid answer must export as text')
  })

  test('the response view names every answer', async () => {
    const r = await req(`/vizit/${visitId}`, { as: U.komil })
    assert.equal(r.status, 200)
    for (const label of ['Shkala', 'Baho', 'Jadval', 'Kanal']) {
      assert.ok(r.text.includes(label), `${label} missing from the response view`)
    }
  })
})

describe('sections and routing', () => {
  after(resetForm)

  const BRANCH = 'q_branch'
  let secondId

  before(async () => {
    await resetForm()
    const d = (await req('/api/form?v=draft', { as: U.komil })).json
    const doc = structuredClone(d.doc)
    doc.settings.pagination = 'sections'

    // a branch that skips the last section entirely, plus a required question
    // sitting on the section that gets skipped
    const last = doc.sections[doc.sections.length - 1]
    secondId = last.id
    doc.sections[0].blocks.push({
      id: BRANCH, kind: 'question', type: 'multiple_choice', title: 'Davom etamizmi?',
      required: false, hidden: false,
      options: [
        { id: 'b1', label: 'Ha' },
        { id: 'b2', label: "Yo'q", goTo: 'submit' },
      ],
    })
    last.blocks.push({
      id: 'q_only_on_last', kind: 'question', type: 'short_answer',
      title: 'Faqat oxirgi bo‘limda', required: true, hidden: false,
    })
    assert.equal((await req('/api/form/draft', { as: U.komil, method: 'PUT', body: { doc, rev: d.rev } })).status, 200)
    assert.equal((await req('/api/form/publish', { as: U.komil, method: 'POST', body: {} })).status, 200)
  })

  test("answering the branch with Yo'q skips the required question on the skipped page", async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), answers: { [BRANCH]: "Yo'q" } },
    })
    assert.equal(r.status, 201, JSON.stringify(r.json))
  })

  test('answering it with Ha then requires that question', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), answers: { [BRANCH]: 'Ha' } },
    })
    assert.equal(r.status, 400)
    assert.match(r.json.error, /Faqat oxirgi bo/)
  })

  test('a jump to a section that no longer exists blocks publishing', async () => {
    const d = (await req('/api/form?v=draft', { as: U.komil })).json
    const doc = structuredClone(d.doc)
    doc.sections[0].blocks.find((b) => b.id === BRANCH).options[0].goTo = 'gone'
    await req('/api/form/draft', { as: U.komil, method: 'PUT', body: { doc, rev: d.rev } })
    // the sanitiser drops a destination that names nothing, so the saved draft
    // is already clean rather than publishable-but-broken
    const back = (await req('/api/form?v=draft', { as: U.komil })).json
    const opt = back.doc.sections[0].blocks.find((b) => b.id === BRANCH).options[0]
    assert.equal(opt.goTo, undefined)
  })
})

describe('form media and import', () => {
  after(resetForm)

  let key

  test('an uploaded image can be placed in the form and is then viewable', async () => {
    const p = await req('/api/uploads/presign', {
      as: U.komil, method: 'POST', body: { contentType: 'image/jpeg', bytes: 200 },
    })
    assert.equal(p.status, 200)
    key = p.json.objectKey
    const put = await fetch(p.json.url, {
      method: 'PUT', body: Buffer.from('ffd8ffe000104a464946', 'hex'),
      headers: { 'content-type': 'image/jpeg' },
    })
    assert.equal(put.status, 200)

    const d = (await req('/api/form?v=draft', { as: U.komil })).json
    const doc = structuredClone(d.doc)
    doc.sections[0].blocks.push({ id: 'i_test', kind: 'image', title: 'Namuna rasm', imageKey: key })
    assert.equal((await req('/api/form/draft', { as: U.komil, method: 'PUT', body: { doc, rev: d.rev } })).status, 200)

    const r = await req(`/api/uploads/view?key=${encodeURIComponent(key)}`, { as: U.sardor })
    assert.ok([302, 307].includes(r.status), `got ${r.status}`)
  })

  test('a key belonging to nothing is still refused', async () => {
    const p = await req('/api/uploads/presign', {
      as: U.komil, method: 'POST', body: { contentType: 'image/jpeg', bytes: 100 },
    })
    const r = await req(`/api/uploads/view?key=${encodeURIComponent(p.json.objectKey)}`, { as: U.komil })
    assert.equal(r.status, 404)
  })

  test('a video block only publishes with a real video url', async () => {
    const d = (await req('/api/form?v=draft', { as: U.komil })).json
    const doc = structuredClone(d.doc)
    doc.sections[0].blocks.push({ id: 'v_test', kind: 'video', title: 'Yo‘riqnoma', url: 'http://example.com/x' })
    await req('/api/form/draft', { as: U.komil, method: 'PUT', body: { doc, rev: d.rev } })
    const bad = await req('/api/form/publish', { as: U.komil, method: 'POST', body: {} })
    assert.equal(bad.status, 422)

    const d2 = (await req('/api/form?v=draft', { as: U.komil })).json
    const fixed = structuredClone(d2.doc)
    fixed.sections[0].blocks.find((b) => b.id === 'v_test').url = 'https://youtu.be/dQw4w9WgXcQ'
    await req('/api/form/draft', { as: U.komil, method: 'PUT', body: { doc: fixed, rev: d2.rev } })
    assert.equal((await req('/api/form/publish', { as: U.komil, method: 'POST', body: {} })).status, 200)
  })

  test('import sources are the published versions, and a manager sees none', async () => {
    const r = await req('/api/form/versions', { as: U.komil })
    assert.equal(r.status, 200)
    assert.ok(r.json.length >= 2, 'earlier versions must remain importable')
    assert.ok(r.json.every((v) => Number(v.questions) > 0))
    assert.equal((await req('/api/form/versions', { as: U.sardor })).status, 403)
  })

  test('the Google import says what is missing rather than failing blindly', async () => {
    const r = await req('/api/form/import/google', { as: U.komil })
    assert.equal(r.status, 200)
    assert.equal(typeof r.json.available, 'boolean')
    const bad = await req('/api/form/import/google', {
      as: U.komil, method: 'POST', body: { url: 'not a form' },
    })
    assert.ok([400, 503].includes(bad.status), `got ${bad.status}`)
    assert.equal((await req('/api/form/import/google', { as: U.sardor })).status, 403)
  })
})

describe('responses survive schema edits', () => {
  const KEEP = 'q_will_be_deleted'
  let visitId, versionWithIt

  before(async () => {
    await resetForm()
    const d = (await req('/api/form?v=draft', { as: U.komil })).json
    const doc = structuredClone(d.doc)
    doc.sections[0].blocks.push({
      id: KEEP, kind: 'question', type: 'short_answer',
      title: 'Vaqtinchalik savol', required: false, hidden: false,
    })
    await req('/api/form/draft', { as: U.komil, method: 'PUT', body: { doc, rev: d.rev } })
    await req('/api/form/publish', { as: U.komil, method: 'POST', body: {} })
    versionWithIt = (await req('/api/form', { as: U.komil })).json.version

    const v = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), answers: { [KEEP]: 'yozildi' } },
    })
    assert.equal(v.status, 201, JSON.stringify(v.json))
    visitId = v.json.id

    // now delete the question and publish again
    const d2 = (await req('/api/form?v=draft', { as: U.komil })).json
    const after = structuredClone(d2.doc)
    after.sections[0].blocks = after.sections[0].blocks.filter((b) => b.id !== KEEP)
    await req('/api/form/draft', { as: U.komil, method: 'PUT', body: { doc: after, rev: d2.rev } })
    assert.equal((await req('/api/form/publish', { as: U.komil, method: 'POST', body: {} })).status, 200)
  })

  test('the answer is still stored', () => {
    assert.equal(psql(`select value #>> '{}' from visit_answers where visit_id = '${visitId}' and block_key = '${KEEP}'`), 'yozildi')
  })

  test('the response view still labels it with the wording that was asked', async () => {
    const r = await req(`/vizit/${visitId}`, { as: U.komil })
    assert.equal(r.status, 200)
    assert.ok(r.text.includes('Vaqtinchalik savol'), 'a deleted question must keep its label on old responses')
  })

  test('the export keeps a column for it, marked as archived', async () => {
    const r = await req('/api/export/csv', { as: U.komil })
    assert.ok(r.text.split('\r\n')[0].includes('Vaqtinchalik savol (arxiv)'), r.text.split('\r\n')[0])
  })

  test('the version it was filled under is still readable', async () => {
    const r = await req(`/api/form?v=${versionWithIt}`, { as: U.komil })
    assert.equal(r.status, 200)
    assert.ok(r.json.doc.sections.flatMap((s) => s.blocks).some((b) => b.id === KEEP))
  })

  test('the live form no longer asks it', async () => {
    const r = await req('/api/form', { as: U.sardor })
    assert.ok(!r.json.doc.sections.flatMap((s) => s.blocks).some((b) => b.id === KEEP))
  })
})

describe('handing stores to people', () => {
  let ids, owner, before_owners

  before(() => {
    owner = U.sardor
    ids = psql("select string_agg(id::text, ',' order by id) from (select id from stores where active order by id offset 2 limit 3) x")
      .split(',').map(Number)
    // put back exactly what was there, not what the test wished was there
    before_owners = psql(`select string_agg(coalesce(quote_literal(owner_id::text), 'null'), ',' order by id)
                            from stores where id in (${ids.join(',')})`).split(',')
  })
  after(() => ids.forEach((id, i) =>
    psql(`update stores set owner_id = ${before_owners[i]}::uuid where id = ${id}`)))

  test('an admin can hand over several stores at once', async () => {
    const r = await req('/api/stores', {
      as: U.komil, method: 'PATCH', body: { store_ids: ids, owner_id: owner },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.updated, 3)
    assert.equal(psql(`select count(*) from stores where owner_id = '${owner}' and id in (${ids.join(',')})`), '3')
  })

  test('and take them back', async () => {
    const r = await req('/api/stores', {
      as: U.komil, method: 'PATCH', body: { store_ids: ids, owner_id: null },
    })
    assert.equal(r.json.updated, 3)
    assert.equal(psql(`select count(*) from stores where owner_id is null and id in (${ids.join(',')})`), '3')
  })

  test('a sotuv_manager cannot reassign anything', async () => {
    const r = await req('/api/stores', {
      as: U.sardor, method: 'PATCH', body: { store_ids: ids, owner_id: U.sardor },
    })
    assert.equal(r.status, 403)
  })

  test('an empty selection is refused rather than quietly doing nothing', async () => {
    const r = await req('/api/stores', { as: U.komil, method: 'PATCH', body: { store_ids: [] } })
    assert.equal(r.status, 400)
  })

  test('the setup page is admin-only', async () => {
    assert.equal((await req('/admin/sozlash', { as: U.komil })).status, 200)
    assert.ok([302, 307].includes((await req('/admin/sozlash', { as: U.sardor })).status))
    assert.ok([302, 307].includes((await req('/admin/sozlash')).status))
  })
})

describe('deleting people who have history', () => {
  let victim, store

  before(() => {
    psql('delete from users where telegram_id in (555000333, 555000444)')
    victim = psql(`with x as (
                     insert into users (telegram_id, full_name, role)
                     values (555000333, 'Vizitli Odam', 'sotuv_manager') returning id)
                   select id from x`)
    store = psql('select id from stores order by code limit 1')
  })
  after(() => psql(`delete from visits where manager_id in
                      (select id from users where telegram_id in (555000333, 555000444));
                    delete from users where telegram_id in (555000333, 555000444)`))

  test('someone with no history is simply deleted', async () => {
    const spare = psql(`with x as (
                          insert into users (telegram_id, full_name, role)
                          values (555000444, 'Bo''sh Odam', 'sotuv_manager') returning id)
                        select id from x`)
    const r = await req(`/api/users/${spare}`, { as: U.komil, method: 'DELETE' })
    assert.equal(r.status, 200)
    assert.equal(psql(`select count(*) from users where id = '${spare}'`), '0')
  })

  test('someone with visits is refused, in Uzbek, and told to deactivate', async () => {
    psql(`insert into visits (manager_id, store_id) values ('${victim}', ${store})`)

    const r = await req(`/api/users/${victim}`, { as: U.komil, method: 'DELETE' })
    assert.equal(r.status, 409)
    assert.match(r.json.error, /faolsizlantiring/i)
    assert.doesNotMatch(r.json.error, /[a-z]+ (person|visits|instead)/i)
    assert.equal(psql(`select count(*) from users where id = '${victim}'`), '1')
  })

  test('and deactivating them works, keeping the visit', async () => {
    const r = await req(`/api/users/${victim}`, { as: U.komil, method: 'PATCH', body: { active: false } })
    assert.equal(r.status, 200)
    assert.equal(r.json.active, false)
    assert.equal(psql(`select count(*) from visits where manager_id = '${victim}'`), '1')
  })

  test('the last direktor is protected, and says so in Uzbek', { skip: !SOLO_DIREKTOR && 'more than one active direktor' }, async () => {
    const r = await req(`/api/users/${U.komil}`, { as: U.komil, method: 'PATCH', body: { role: 'sotuv_manager' } })
    assert.equal(r.status, 409)
    assert.match(r.json.error, /direktorni/i)
  })
})

describe('signing out', () => {
  test('a GET cannot sign anyone out', async () => {
    // a prefetch or a crawler following a link must not end a session
    const r = await req('/api/auth/logout', { as: U.komil })
    assert.equal(r.status, 405)
  })

  test('a POST clears the session cookie', async () => {
    const r = await fetch(BASE + '/api/auth/logout', {
      method: 'POST', redirect: 'manual', headers: { cookie: cookie(U.komil) },
    })
    assert.equal(r.status, 303)
    const set = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('falaq_session='))
    assert.ok(set, 'no falaq_session cookie was set')
    assert.match(set, /falaq_session=;/)
  })

  test('and sends you back to the host you came from, not localhost', async () => {
    // fetch() drops a Host header, so this has to go through raw http
    const http = await import('node:http')
    const location = await new Promise((resolve, reject) => {
      const rq = http.request(
        { host: '127.0.0.1', port: PORT, path: '/api/auth/logout', method: 'POST',
          headers: { host: `192.168.1.245:${PORT}`, cookie: cookie(U.komil) } },
        (res) => { res.resume(); resolve(res.headers.location) },
      )
      rq.on('error', reject)
      rq.end()
    })
    assert.equal(location, `http://192.168.1.245:${PORT}/login`)
  })

  test('the header offers it once you are in, and not before', async () => {
    assert.match((await req('/', { as: U.komil })).text, /\/api\/auth\/logout/)
    assert.doesNotMatch((await req('/login')).text, /\/api\/auth\/logout/)
  })
})

describe('caching the lists that barely change', () => {
  const headersOf = async (path) => {
    const r = await fetch(BASE + path, { headers: { cookie: cookie(U.komil) } })
    return { cc: r.headers.get('cache-control'), vary: r.headers.get('vary') }
  }

  for (const path of ['/api/stores', '/api/stores?reja=1', '/api/books', '/api/form']) {
    test(`${path} is cacheable, privately and per cookie`, async () => {
      const { cc, vary } = await headersOf(path)
      assert.match(cc, /private/)
      assert.match(cc, /max-age=\d+/)
      assert.doesNotMatch(cc, /public/)
      // without this, signing in as someone else could show the previous
      // person's territory straight out of the browser's disk cache
      assert.match(vary ?? '', /Cookie/i)
    })
  }

  test('a draft form is never cached — it is being edited', async () => {
    const { cc } = await headersOf('/api/form?v=draft')
    assert.ok(!cc || !/max-age=[1-9]/.test(cc), `got ${cc}`)
  })

  test('a visit list is not cached either', async () => {
    const { cc } = await headersOf('/api/visits')
    assert.ok(!cc || !/max-age=[1-9]/.test(cc), `got ${cc}`)
  })
})

describe('the form editor when the session dies mid-edit', () => {
  test('a draft save with no session is a 401 saying kirish kerak', async () => {
    const d = (await req('/api/form?v=draft', { as: U.komil })).json
    const r = await req('/api/form/draft', { method: 'PUT', body: { doc: d.doc, rev: d.rev } })
    assert.equal(r.status, 401)
    assert.match(r.json.error, /kirish kerak/)
  })

  test('a draft save with a forged session is a 401 too, not a 500', async () => {
    const d = (await req('/api/form?v=draft', { as: U.komil })).json
    const r = await fetch(BASE + '/api/form/draft', {
      method: 'PUT',
      headers: { cookie: `falaq_session=${U.komil}.notthesignature`, 'content-type': 'application/json' },
      body: JSON.stringify({ doc: d.doc, rev: d.rev }),
    })
    assert.equal(r.status, 401)
  })

  test('the draft is untouched by a rejected save', async () => {
    const before = (await req('/api/form?v=draft', { as: U.komil })).json.rev
    await req('/api/form/draft', { method: 'PUT', body: { doc: { bogus: true }, rev: before } })
    const after = (await req('/api/form?v=draft', { as: U.komil })).json.rev
    assert.equal(after, before)
  })
})

describe('a visit reaches Google Sheets by itself', () => {
  // paused for the whole run, so these test the machinery, not Google
  const state = () => JSON.parse(psql(`select row_to_json(x) from (
    select dirty, paused, last_ok_at is not null as ever_ok from sheets_sync where id) x`))

  test('saving a visit marks the spreadsheet as owed', async () => {
    psql("update sheets_sync set dirty = false, dirty_since = null where id")
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(STORE_A), note: 'sinov' },
    })
    assert.equal(r.status, 201)

    // the push is fired after the response returns, so wait for it to register
    // rather than guessing at a sleep
    let dirty = false
    for (let i = 0; i < 30 && !dirty; i++) {
      await new Promise((r) => setTimeout(r, 100))
      dirty = state().dirty
    }
    assert.equal(dirty, true, 'the visit did not mark the sheet dirty')
  })

  test('the manager is not made to wait for Google', async () => {
    const t0 = Date.now()
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(STORE_A) },
    })
    assert.equal(r.status, 201)
    // a Sheets round trip is seconds; the response must not contain one
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`)
  })

  test('while paused nothing is pushed and the debt is kept', async () => {
    const r = await req('/api/sync/sheets', { as: U.komil, method: 'POST' })
    assert.equal(r.status, 409)
    assert.equal(state().dirty, true, 'a paused push must not clear the debt')
  })

  test('a manager cannot trigger a whole-company push', async () => {
    const r = await req('/api/sync/sheets', { as: U.sardor, method: 'POST' })
    assert.equal(r.status, 403)
  })

  test('the status endpoint reports the pause and the debt', async () => {
    const r = await req('/api/sync/sheets', { as: U.komil })
    assert.equal(r.status, 200)
    assert.equal(r.json.paused, true)
    assert.equal(r.json.dirty, true)
  })

  test('two pushes cannot interleave', async () => {
    // hold the lease the way a running push does
    psql("update sheets_sync set paused = false, running_until = now() + interval '1 minute' where id")
    const r = await req('/api/sync/sheets', { as: U.komil, method: 'POST' })
    assert.equal(r.status, 409)
    psql("update sheets_sync set running_until = null, paused = true where id")
  })
})

describe('pointing the export at a different spreadsheet', () => {
  // the parser is the whole feature: whatever a person pastes has to resolve to
  // an id, and anything that is not a Sheets link has to be refused loudly
  const ID = '16XOKw7XXTijrMqXjE20nBFgYI5JeBFcF-Vl2onPF9P0'

  test('every shape of Sheets URL resolves to the same id', async () => {
    const { spreadsheetIdFrom } = await import('../lib/sheets.ts')
    for (const url of [
      `https://docs.google.com/spreadsheets/d/${ID}/edit?gid=0#gid=0`,
      `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`,
      `https://docs.google.com/spreadsheets/d/${ID}/copy`,
      `https://docs.google.com/spreadsheets/d/${ID}`,
      `  ${ID}  `,                      // a bare id still works
    ]) {
      assert.equal(spreadsheetIdFrom(url), ID, url)
    }
  })

  test('something that is not a Sheets link is refused, not half-accepted', async () => {
    const { spreadsheetIdFrom } = await import('../lib/sheets.ts')
    for (const bad of ['', '   ', 'not a url', 'https://example.com/x',
                       'https://docs.google.com/document/d/abcdefghijklmnopqrstuvwx/edit']) {
      assert.equal(spreadsheetIdFrom(bad), null, JSON.stringify(bad))
    }
  })

  test('a link can name the tab: #gid or ?gid, and no gid means none', async () => {
    const { gidFrom } = await import('../lib/sheets.ts')
    assert.equal(gidFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=980051084`), '980051084')
    assert.equal(gidFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=0#gid=0`), '0')
    assert.equal(gidFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`), null)
    assert.equal(gidFrom(ID), null)
  })

  test('the status endpoint names the sheet it will write to', async () => {
    const r = await req('/api/sync/sheets', { as: U.komil })
    assert.equal(r.status, 200)
    if (r.json.configured) {
      assert.match(r.json.sheet.url, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/edit(#gid=\d+)?$/)
      assert.equal(r.json.problem, null)
    }
  })
})

describe('pulling the must-list out of the spreadsheet', () => {
  // runs BEFORE the fixture suites below: a real sync replaces every weight
  test('a sotuv_manager cannot trigger it', async () => {
    assert.equal((await req('/api/mml/sync', { as: U.sardor, method: 'POST' })).status, 403)
  })

  test('anonymous cannot either', async () => {
    const r = await req('/api/mml/sync', { method: 'POST' })
    assert.ok([401, 500].includes(r.status), `got ${r.status}`)
  })

  test('an admin gets a report, or a clean reason it could not run', async () => {
    // really calls Google: it worked, credentials are missing, or the sheet said no
    const r = await req('/api/mml/sync', { as: U.komil, method: 'POST' })
    assert.ok([200, 502, 503].includes(r.status), `got ${r.status}`)
    if (r.status !== 200) { assert.ok(r.json.error, 'a failure must say why'); return }
    assert.ok(r.json.columns.length > 1)
    assert.ok(r.json.weights > 0)
    assert.ok(r.json.books.matched > 0)
    for (const k of ['aliased', 'created', 'notInSheet']) assert.ok(Array.isArray(r.json.books[k]), k)
    assert.ok(r.json.targets.every((t) => t.total >= t.named))
  })

  test('the per-store exception buttons are gone', async () => {
    const r = await req('/api/mml/override', {
      as: U.komil, method: 'PATCH', body: { store_id: 1, book_id: 1, required: false },
    })
    assert.ok([404, 405].includes(r.status), `got ${r.status}`)
  })
})

describe('MML from weights: named titles and category shares', () => {
  // A private column and private books, so the arithmetic can be checked by
  // hand without depending on what the real sheet says today.
  const COL = 'TEST MML ustun'
  let store, saved, named, share, tiny

  const lit = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
  const book = (title, category) => psql(`with x as (
      insert into books (title, category) values (${lit(title)}, ${lit(category)})
      on conflict (title) do update set category = excluded.category, active = true
      returning id) select id from x`)
  const row = () => JSON.parse(psql(`select row_to_json(x) from
      (select store_category, kerak, bor, yetishmaydi, mml from v_mml where store_id = ${store}) x`))
  const clean = () => {
    psql(`delete from visit_books where visit_id in (select id from visits where store_id = ${store});
          delete from visits where store_id = ${store};
          delete from store_stock where store_id = ${store};
          delete from mml_weights where mml_column like 'TEST MML%';
          delete from books where title like 'TEST MML %';`)
  }

  before(() => {
    store = psql("select id from stores where active order by id offset 30 limit 1")
    saved = JSON.parse(psql(`select row_to_json(x) from
      (select store_type, grade, owner_id from stores where id = ${store}) x`))
    // since db/25 a visit may only be filed against a shop that is the
    // manager's, and these tests file visits as sardor
    psql(`update stores set owner_id = '${U.sardor}' where id = ${store}`)
    clean()
    named = book('TEST MML nomma', 'TESTN')
    // three titles at 0,5 -> 1,5 -> target 2
    share = [1, 2, 3].map((i) => book(`TEST MML ulush ${i}`, 'TESTU'))
    // five titles at 0,2 -> 1,0 exactly -> target 1 (floating point would say 2)
    tiny = [1, 2, 3, 4, 5].map((i) => book(`TEST MML kichik ${i}`, 'TESTK'))
    psql(`insert into mml_weights (mml_column, book_id, weight) values
      ('${COL}', ${named}, 1),
      ${share.map((id) => `('${COL}', ${id}, 0.5)`).join(', ')},
      ${tiny.map((id) => `('${COL}', ${id}, 0.2)`).join(', ')}`)
    psql(`update stores set store_type = '${COL}', grade = null where id = ${store}`)
  })
  after(() => {
    clean()
    psql(`update stores set store_type = ${lit(saved.store_type)}, grade = ${lit(saved.grade)},
                            owner_id = ${lit(saved.owner_id)}::uuid where id = ${store}`)
  })

  test('targets round up, in exact decimals', () => {
    const t = Object.fromEntries(psql(`select string_agg(book_category || '=' || target, ',')
      from v_mml_pool_target where mml_column = '${COL}'`).split(',').map((x) => x.split('=')))
    assert.equal(t.TESTU, '2', '3 x 0,5 = 1,5 must round up to 2')
    assert.equal(t.TESTK, '1', '5 x 0,2 = 1 exactly, not 2')
  })

  test('a store owes its named titles plus each share, and scores null unmeasured', () => {
    const r = row()
    assert.equal(r.store_category, COL)
    assert.equal(r.kerak, 1 + 2 + 1)
    assert.equal(r.mml, null)
  })

  test('a visit that finds everything scores 100%, never more', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(store), present_book_ids: [named, ...share, ...tiny].map(Number) },
    })
    assert.equal(r.status, 201)
    const m = row()
    // 1 named + min(3, 2) + min(5, 1)
    assert.equal(m.bor, 4)
    assert.equal(m.yetishmaydi, 0)
    assert.equal(Number(m.mml), 100)
  })

  test('a visit that finds one share title scores it and nothing else', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(store), present_book_ids: [Number(share[0])] },
    })
    assert.equal(r.status, 201)
    const m = row()
    assert.equal(m.bor, 1)
    assert.equal(m.yetishmaydi, 3)
    assert.equal(Number(m.mml), 25)
  })

  test('the endpoint names the titles and states each share', async () => {
    const r = await req(`/api/mml?dokon=${store}`, { as: U.sardor })
    assert.equal(r.status, 200)
    const kinds = r.json.detail.reduce((a, d) => ((a[d.kind] = (a[d.kind] ?? 0) + 1), a), {})
    assert.deepEqual(kinds, { nomma: 1, ulush: 8 })
    const shares = Object.fromEntries(r.json.shares.map((x) => [x.book_category, [Number(x.target), Number(x.hisob)]]))
    assert.deepEqual(shares, { TESTU: [2, 1], TESTK: [1, 0] })
  })

  test('marking a title on the shelf by hand counts, and clearing it does not', async () => {
    const put = await req('/api/mml/stock', {
      as: U.komil, method: 'PUT', body: { store_id: Number(store), book_id: Number(named), present: true },
    })
    assert.equal(put.status, 200)
    assert.equal(row().bor, 2)
    // the visit itself is never edited
    assert.equal(psql(`select count(*) from visit_books vb join visits v on v.id = vb.visit_id
                        where v.store_id = ${store} and vb.book_id = ${named}`), '1')
    const del = await req('/api/mml/stock', {
      as: U.komil, method: 'DELETE', body: { store_id: Number(store), book_id: Number(named) },
    })
    assert.equal(del.status, 200)
    assert.equal(row().bor, 1)
  })

  test('rubbish ids are refused', async () => {
    for (const body of [{}, { store_id: 'x', book_id: 1 }, { store_id: 1, book_id: -3 }]) {
      const r = await req('/api/mml/stock', { as: U.komil, method: 'PUT', body })
      assert.equal(r.status, 400, JSON.stringify(body))
    }
  })

  test('bookstores are measured by grade; A++ owes every title', () => {
    const was = JSON.parse(psql(`select row_to_json(x) from (select store_type, grade from stores where id = ${store}) x`))
    const column = (type, grade) => {
      psql(`update stores set store_type = ${lit(type)}, grade = ${lit(grade)} where id = ${store}`)
      return psql(`select mml_column from v_store_mml_column where store_id = ${store}`)
    }
    try {
      assert.equal(column("Kitob do'kon", 'A+'), "Kitob do'kon (A)")
      assert.equal(column("Kitob do'kon", 'A'), "Kitob do'kon (A)")
      assert.equal(column("Kitob do'kon", 'B'), "Kitob do'kon (B)")
      assert.equal(column("Kitob do'kon", 'C'), "Kitob do'kon (C)")
      assert.equal(column("Kitob do'kon", null), "Kitob do'kon (C)", 'an ungraded bookstore is measured as C')
      assert.equal(column('Kanselyariya (Kanstovar)', 'A+'), 'Kanselyariya (Kanstovar)')
      assert.equal(column('Supermarket', 'A++'), 'Barcha kitoblar (A++)')
    } finally {
      psql(`update stores set store_type = ${lit(was.store_type)}, grade = ${lit(was.grade)} where id = ${store}`)
    }
  })

  test('everyone sees the same list, only an admin may edit, and the page is gated', async () => {
    const mine = await req('/api/mml', { as: U.sardor })
    const komil = await req('/api/mml', { as: U.komil })
    assert.equal(mine.status, 200)
    assert.equal(mine.json.stores.length, komil.json.stores.length)
    assert.equal(mine.json.canEdit, false)
    assert.equal(komil.json.canEdit, true)
    assert.equal((await req('/admin/mml', { as: U.sardor })).status, 200)
    assert.ok([302, 307].includes((await req('/admin/mml')).status))
  })
})

describe('the weekly plan', () => {
  let week, past, past2, today, sunday, store, other, third, fourth, savedOwners

  const clean = () => psql(`delete from week_plans
      where week_start in ('${week}', '${past}', '${past2}')
        and store_id in (${store}, ${other}, ${third}, ${fourth});
    delete from visit_books where visit_id in (
      select id from visits where store_id in (${store}, ${other}, ${third}, ${fourth}));
    delete from visits where store_id in (${store}, ${other}, ${third}, ${fourth})`)

  const plan = (body, as = U.komil) => req('/api/plan', { as, method: 'POST', body })
  const patch = (body, as = U.komil) => req('/api/plan', { as, method: 'PATCH', body })
  const rowOf = (json, s) => json.rows.find((x) => String(x.store_id) === String(s))
  const day = (w, n) => psql(`select ('${w}'::date + ${n})::text`)
  const visitOn = (who, s, d) => psql(`with x as (
      insert into visits (manager_id, store_id, visited_at) values ('${who}', ${s}, '${d} 12:00')
      returning id) select id from x`)

  before(() => {
    week = psql('select week_of()::text')
    past = psql('select (week_of() - 14)::text')
    past2 = psql('select (week_of() - 21)::text')
    today = psql('select current_date::text')
    sunday = psql('select (week_of() + 6)::text')
    // deliberately NOT the first stores: earlier suites visit those, and a
    // leftover visit would make a planned shop look done before anyone went
    const ids = psql("select string_agg(id::text, ',' order by id) from (select id from stores where active order by id offset 7 limit 4) x").split(',')
    ;[store, other, third, fourth] = ids
    savedOwners = psql(`select string_agg(coalesce(quote_literal(owner_id::text), 'null'), ',' order by id)
                          from stores where id in (${ids.join(',')})`).split(',')
    // a visit can only be filed against your own shop now (db/25). The plan is
    // a separate thing — who should go WHEN — so the two are set up separately:
    // sardor owns three of these, otabek the one he covers in his own test.
    psql(`update stores set owner_id = '${U.sardor}' where id in (${store}, ${third}, ${fourth});
          update stores set owner_id = '${U.otabek}' where id = ${other};`)
    clean()
  })
  after(() => {
    clean()
    if (savedOwners) {
      for (const [i, id] of [store, other, third, fourth].entries()) {
        psql(`update stores set owner_id = ${savedOwners[i]}::uuid where id = ${id}`)
      }
    }
  })

  test('an admin gives shops to a person on a day', async () => {
    const r = await plan({ sana: today, user_id: U.sardor, store_ids: [Number(store), Number(other)] })
    assert.equal(r.status, 200)
    assert.equal(r.json.assigned, 2)
    assert.equal(r.json.week, week)
    assert.equal(psql(`select count(*) from week_plans where week_start = '${week}' and visit_date = '${today}'`), '2')
  })

  test('a day has to be chosen, and has to be a real date', async () => {
    assert.equal((await plan({ user_id: U.sardor, store_ids: [Number(store)] })).status, 400)
    assert.equal((await plan({ sana: '2026-02-30', user_id: U.sardor, store_ids: [Number(store)] })).status, 400)
  })

  test('a manager cannot plan anybody\'s week', async () => {
    const r = await plan({ sana: today, user_id: U.sardor, store_ids: [Number(store)] }, U.sardor)
    assert.equal(r.status, 403)
  })

  test('a shop planned for today is "bugun" until they go', async () => {
    const r = await req(`/api/plan?hafta=${week}`, { as: U.komil })
    assert.equal(r.status, 200)
    assert.equal(r.json.today, today)
    assert.equal(rowOf(r.json, store).holat, 'bugun')
    assert.equal(rowOf(r.json, store).visit_date, today)
    const s = r.json.summary.find((x) => x.user_id === U.sardor)
    assert.equal(Number(s.reja), 2)
    assert.equal(Number(s.bajarildi), 0)
    assert.equal(Number(s.qoldi), 2)
  })

  test('their own visit on the day completes the task', async () => {
    assert.equal((await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(store) },
    })).status, 201)

    const r = await req(`/api/plan?hafta=${week}`, { as: U.komil })
    assert.equal(rowOf(r.json, store).holat, 'bajarildi')
    const s = r.json.summary.find((x) => x.user_id === U.sardor)
    assert.equal(Number(s.bajarildi), 1)
    assert.equal(Number(s.vaqtida), 1)
    assert.equal(Number(s.qoldi), 1)
    assert.equal(Number(s.foiz), 50)
  })

  test('somebody else visiting does NOT complete it, but is reported', async () => {
    assert.equal((await req('/api/visits', {
      as: U.otabek, method: 'POST', body: { store_id: Number(other) },
    })).status, 201)

    const r = await req(`/api/plan?hafta=${week}`, { as: U.komil })
    const row = rowOf(r.json, other)
    assert.equal(row.bajarildi, false, 'another person\'s visit closed the task')
    assert.ok(row.boshqa_vizit, 'the cover visit was not reported')
  })

  test('completion is a fact, not a matter of who is asking', () => {
    // v_week_plan is security_invoker, so a direktor who cannot see a
    // manager's visits used to be told the work was not done. The lookup is
    // SECURITY DEFINER for exactly this reason.
    const asOwner = psql(`select count(*) from v_week_plan
                           where week_start = '${week}' and bajarildi`)
    assert.equal(asOwner, '1')
  })

  test('an admin moves a planned shop to another day of the same week', async () => {
    const r = await patch({ store_id: Number(other), sana: today, yangi_sana: sunday })
    assert.equal(r.status, 200)
    assert.equal(psql(`select visit_date::text from week_plans where week_start='${week}' and store_id=${other}`), sunday)
    const g = await req(`/api/plan?hafta=${week}`, { as: U.komil })
    assert.ok(['rejada', 'bugun'].includes(rowOf(g.json, other).holat))
  })

  test('a move cannot leave the week — not through the API, not in the table', async () => {
    assert.equal((await patch({ store_id: Number(other), sana: sunday, yangi_sana: day(week, 7) })).status, 400)
    assert.throws(() => psql(`update week_plans set visit_date = week_start + 7
                               where week_start='${week}' and store_id=${other}`))
  })

  test('an admin hands a planned shop to another person', async () => {
    const r = await patch({ store_id: Number(other), sana: sunday, user_id: U.otabek })
    assert.equal(r.status, 200)
    assert.equal(psql(`select user_id::text from week_plans where week_start='${week}' and store_id=${other}`), U.otabek)
    // and the cover visit otabek already made now counts as theirs
    const g = await req(`/api/plan?hafta=${week}`, { as: U.komil })
    assert.equal(rowOf(g.json, other).bajarildi, true)
  })

  test('moving needs something to move, a known shop, and an admin', async () => {
    assert.equal((await patch({ store_id: Number(other), sana: sunday })).status, 400)
    assert.equal((await patch({ store_id: Number(third), sana: today, yangi_sana: sunday })).status, 404)
    assert.equal((await patch({ store_id: Number(other), sana: sunday, yangi_sana: today }, U.sardor)).status, 403)
  })

  test('in a finished week: on the day, early, late, and not at all', async () => {
    const wed = day(past, 2)
    for (const s of [store, other, third, fourth]) {
      assert.equal((await plan({ sana: wed, user_id: U.sardor, store_ids: [Number(s)] })).status, 200)
    }
    visitOn(U.sardor, store, wed)            // on the day
    visitOn(U.sardor, fourth, day(past, 0))  // Monday, before the planned day
    visitOn(U.sardor, other, day(past, 4))   // Friday, late
    // third: nobody went

    const r = await req(`/api/plan?hafta=${past}`, { as: U.komil })
    assert.equal(rowOf(r.json, store).holat, 'bajarildi')
    assert.equal(rowOf(r.json, fourth).holat, 'bajarildi')
    assert.equal(rowOf(r.json, other).holat, 'kechikdi')
    assert.equal(rowOf(r.json, third).holat, 'borilmadi')

    const s = r.json.summary.find((x) => x.user_id === U.sardor)
    assert.deepEqual(
      [s.reja, s.bajarildi, s.vaqtida, s.kechikdi, s.qoldi, s.borilmadi].map(Number),
      [4, 3, 2, 1, 1, 1])
    assert.equal(Number(s.foiz), 75)
  })

  test('a planned day that has passed this week is "kechikmoqda", not yet missed',
    { skip: psql('select extract(isodow from current_date)') === '1' && 'today is Monday' },
    async () => {
      assert.equal((await plan({ sana: week, user_id: U.sardor, store_ids: [Number(third)] })).status, 200)
      const r = await req(`/api/plan?hafta=${week}`, { as: U.komil })
      assert.equal(rowOf(r.json, third).holat, 'kechikmoqda')
    })

  test('several days at once: every shop on every day, all in one week', async () => {
    const [a, b] = [day(week, 1), day(week, 4)]
    const r = await plan({ sanalar: [a, b], user_id: U.sardor, store_ids: [Number(fourth), Number(third)] })
    assert.equal(r.status, 200)
    assert.equal(r.json.assigned, 4)
    assert.equal(psql(`select string_agg(visit_date::text, ',' order by visit_date) from week_plans
                        where week_start='${week}' and store_id=${fourth}`), `${a},${b}`)
    assert.equal((await plan({ sanalar: [a, day(week, 7)], user_id: U.sardor, store_ids: [Number(fourth)] })).status, 400,
      'days from two different weeks were accepted')
    assert.equal((await plan({ sanalar: [], user_id: U.sardor, store_ids: [Number(fourth)] })).status, 400)
  })

  test('the same shop on the same day is one task; planning it again hands it over', async () => {
    const d = day(week, 1)
    const r = await plan({ sanalar: [d], user_id: U.otabek, store_ids: [Number(fourth)] })
    assert.equal(r.status, 200)
    assert.equal(psql(`select count(*) from week_plans where store_id=${fourth} and visit_date='${d}'`), '1')
    assert.equal(psql(`select user_id::text from week_plans where store_id=${fourth} and visit_date='${d}'`), U.otabek)
    assert.equal(psql(`select count(*) from week_plans where week_start='${week}' and store_id=${fourth}`), '2',
      'the other day of that shop was touched')
  })

  test('a day cannot be moved onto a day that shop already has', async () => {
    const r = await patch({ store_id: Number(fourth), sana: day(week, 1), yangi_sana: day(week, 4) })
    assert.equal(r.status, 409)
  })

  test('taking one day off leaves the other days of that shop', async () => {
    const r = await req('/api/plan', {
      as: U.komil, method: 'DELETE', body: { sana: day(week, 4), store_ids: [Number(fourth)] },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.removed, 1)
    assert.equal(psql(`select string_agg(visit_date::text, ',') from week_plans
                        where week_start='${week}' and store_id=${fourth}`), day(week, 1))
  })

  test('two days of one shop: one visit closes one task, not both', async () => {
    const [mon, tue, thu] = [day(past2, 0), day(past2, 1), day(past2, 3)]
    assert.equal((await plan({ sanalar: [mon, thu], user_id: U.sardor,
      store_ids: [Number(store), Number(other)] })).status, 200)
    visitOn(U.sardor, store, tue)   // after Monday, before Thursday: Monday, late
    visitOn(U.sardor, store, thu)   // Thursday, on the day
    visitOn(U.sardor, other, mon)   // only Monday

    const r = await req(`/api/plan?hafta=${past2}`, { as: U.komil })
    const at = (s, d) => r.json.rows.find((x) => String(x.store_id) === String(s) && x.visit_date === d).holat
    assert.equal(at(store, mon), 'kechikdi')
    assert.equal(at(store, thu), 'bajarildi')
    assert.equal(at(other, mon), 'bajarildi')
    assert.equal(at(other, thu), 'borilmadi', 'one Monday visit closed the Thursday task too')
  })

  test('a shop can be taken off the plan', async () => {
    const r = await req('/api/plan', {
      as: U.komil, method: 'DELETE', body: { hafta: week, store_ids: [Number(store)] },
    })
    assert.equal(r.status, 200)
    assert.equal(psql(`select count(*) from week_plans where week_start='${week}' and store_id=${store}`), '0')
  })

  test('a manager sees their own week but cannot edit it', async () => {
    await plan({ sana: today, user_id: U.sardor, store_ids: [Number(store)] })
    const r = await req(`/api/plan?hafta=${week}`, { as: U.sardor })
    assert.equal(r.status, 200)
    assert.equal(r.json.canEdit, false)
    assert.ok(r.json.rows.some((x) => String(x.user_id) === String(U.sardor)))
  })

  test('the page is reachable signed in, and not otherwise', async () => {
    assert.equal((await req('/admin/reja', { as: U.sardor })).status, 200)
    assert.ok([302, 307].includes((await req('/admin/reja')).status))
  })
})

describe('the store directory from the spreadsheet', () => {
  let a, b, saved
  const lit = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

  before(() => {
    ;[a, b] = psql("select string_agg(id::text, ',' order by id) from (select id from stores where active order by id limit 2) x").split(',')
    saved = JSON.parse(psql(`select json_agg(json_build_object('id', id, 't', territory, 's', store_type))
                               from stores where id in (${a}, ${b})`))
    psql(`update stores set territory = 'TEST Hudud',  store_type = 'TEST turi' where id = ${a};
          update stores set territory = 'TEST Boshqa', store_type = 'TEST turi' where id = ${b};`)
  })
  after(() => {
    for (const r of saved) psql(`update stores set territory = ${lit(r.t)}, store_type = ${lit(r.s)} where id = ${r.id}`)
  })

  test('a sotuv_manager cannot pull the store list', async () => {
    assert.equal((await req('/api/stores/sync', { as: U.sardor, method: 'POST' })).status, 403)
  })

  test('anonymous cannot either', async () => {
    const r = await req('/api/stores/sync', { method: 'POST' })
    assert.ok([401, 500].includes(r.status), `got ${r.status}`)
  })

  test('an admin gets a report, or a clean reason it could not run', async () => {
    // really calls Google: it worked, credentials are missing, or the sheet said no
    const r = await req('/api/stores/sync', { as: U.komil, method: 'POST' })
    assert.ok([200, 502, 503].includes(r.status), `got ${r.status}`)
    if (r.status !== 200) { assert.ok(r.json.error, 'a failure must say why'); return }
    assert.ok(r.json.total > 0)
    assert.ok(Array.isArray(r.json.retired) && Array.isArray(r.json.skipped))
    // the import may have rewritten the fixture rows; put the test values back
    psql(`update stores set territory = 'TEST Hudud',  store_type = 'TEST turi' where id = ${a};
          update stores set territory = 'TEST Boshqa', store_type = 'TEST turi' where id = ${b};`)
  })

  test('/dokon filters by territory, by type, and by "not set"', async () => {
    const has = (html, id) => html.includes(`href="/dokon/${id}"`)
    const byTerritory = await req('/dokon?hudud=TEST%20Hudud', { as: U.komil })
    assert.equal(byTerritory.status, 200)
    assert.ok(has(byTerritory.text, a) && !has(byTerritory.text, b))

    const byType = await req('/dokon?turi=TEST%20turi', { as: U.komil })
    assert.ok(has(byType.text, a) && has(byType.text, b))

    const both = await req('/dokon?hudud=TEST%20Boshqa&turi=TEST%20turi', { as: U.komil })
    assert.ok(!has(both.text, a) && has(both.text, b))

    const unset = await req('/dokon?hudud=-', { as: U.komil })
    assert.ok(!has(unset.text, a) && !has(unset.text, b))
  })

  test('the plan and MML APIs carry territory and type for their filters', async () => {
    const plan = await req('/api/plan', { as: U.komil })
    const s = plan.json.stores.find((x) => String(x.id) === String(a))
    assert.equal(s.territory, 'TEST Hudud')
    assert.equal(s.store_type, 'TEST turi')

    const mml = await req('/api/mml', { as: U.komil })
    assert.equal(mml.status, 200)
    if (mml.json.stores.length) assert.ok('territory' in mml.json.stores[0] && 'store_type' in mml.json.stores[0])
  })
})

describe('an admin deleting a filed visit', () => {
  let VISIT

  test('a manager files one, with books on it', async () => {
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST',
      body: { store_id: Number(STORE_A), present_book_ids: [1, 2], stale_book_ids: [3], note: 'delete me' },
    })
    assert.equal(r.status, 201)
    VISIT = r.json.id
    assert.equal(psql(`select count(*) from visit_books where visit_id = '${VISIT}'`), '3')
  })

  test('the manager who filed it cannot delete it', async () => {
    const r = await req(`/api/visits/${VISIT}`, { as: U.sardor, method: 'DELETE' })
    assert.equal(r.status, 403)
    assert.equal(psql(`select count(*) from visits where id = '${VISIT}'`), '1')
  })

  test('a hudud_rahbari who can see it still cannot delete it', async () => {
    // seeing and removing are different powers: the whole point of the audit
    const r = await req(`/api/visits/${VISIT}`, { as: U.dilshod, method: 'DELETE' })
    assert.equal(r.status, 403)
    assert.equal(psql(`select count(*) from visits where id = '${VISIT}'`), '1')
  })

  test('the direktor deletes it, and the book rows go with it', async () => {
    const r = await req(`/api/visits/${VISIT}`, {
      as: U.komil, method: 'DELETE', body: { sabab: 'ikki marta yuborilgan' },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.deleted, true)
    assert.equal(psql(`select count(*) from visits where id = '${VISIT}'`), '0')
    assert.equal(psql(`select count(*) from visit_books where visit_id = '${VISIT}'`), '0')
  })

  test('the deletion is written down: who, why, and which shop', async () => {
    assert.equal(psql(`select reason from deleted_visits where visit_id = '${VISIT}'`),
      'ikki marta yuborilgan')
    assert.equal(psql(`select deleted_by from deleted_visits where visit_id = '${VISIT}'`), U.komil)
    // the code is copied into the log, not joined, so it outlives the shop
    assert.ok(psql(`select store_code from deleted_visits where visit_id = '${VISIT}'`).length > 0)
  })

  test('the app role cannot rewrite the log it just wrote', () => {
    assert.equal(psql(`select has_table_privilege('falaq_app', 'deleted_visits', 'delete')`), 'f')
    assert.equal(psql(`select has_table_privilege('falaq_app', 'deleted_visits', 'update')`), 'f')
  })

  test('deleting it again is a 404, not a second log row', async () => {
    const r = await req(`/api/visits/${VISIT}`, { as: U.komil, method: 'DELETE' })
    assert.equal(r.status, 404)
    assert.equal(psql(`select count(*) from deleted_visits where visit_id = '${VISIT}'`), '1')
  })

  test('an id that is not a uuid is a 404, not a crash', async () => {
    const r = await req('/api/visits/not-a-uuid', { as: U.komil, method: 'DELETE' })
    assert.equal(r.status, 404)
  })
})

describe('the new-visit list is the shops you were given', () => {
  let week, past, today, mine, second, oldDone, oldOpen, notMine, all, savedOwners

  const ids = () => [mine, second, oldDone, oldOpen, notMine].join(',')
  const clean = () => psql(`delete from week_plans where store_id in (${ids()});
    delete from visit_books where visit_id in (select id from visits where store_id in (${ids()}));
    delete from visits where store_id in (${ids()})`)

  // straight into the table: the API refuses to plan across two weeks, and
  // "a task left over from last week" is the whole point of these tests
  const planRow = (who, store, date, weekStart) => psql(`
    insert into week_plans (week_start, visit_date, store_id, user_id)
    values ('${weekStart}', '${date}', ${store}, '${who}')
    on conflict (store_id, visit_date) do update set user_id = excluded.user_id`)
  const visitOn = (who, store, date) =>
    psql(`insert into visits (manager_id, store_id, visited_at) values ('${who}', ${store}, '${date} 12:00')`)
  const menga = (as) => req('/api/stores?menga=1', { as })
  const codes = (json) => json.map((s) => String(s.id))

  before(() => {
    week = psql('select week_of()::text')
    past = psql('select (week_of() - 7)::text')
    today = psql('select current_date::text')
    // well clear of the shops earlier suites visit and plan
    all = psql("select string_agg(id::text, ',' order by id) from (select id from stores where active order by id offset 21 limit 5) x").split(',')
    ;[mine, second, oldDone, oldOpen, notMine] = all
    savedOwners = psql(`select string_agg(coalesce(quote_literal(owner_id::text), 'null'), ',' order by id)
                          from stores where id in (${ids()})`).split(',')
    // db/25: the list is stores.owner_id, not the plan. Four are sardor's, the
    // fifth is otabek's.
    psql(`update stores set owner_id = '${U.sardor}'
           where id in (${mine}, ${second}, ${oldDone}, ${oldOpen});
          update stores set owner_id = '${U.otabek}' where id = ${notMine};`)
    clean()
  })
  after(() => {
    clean()
    for (const [i, id] of all.entries()) {
      psql(`update stores set owner_id = ${savedOwners[i]}::uuid where id = ${id}`)
    }
  })

  test('the shops given to you are the list', async () => {
    const r = await menga(U.sardor)
    assert.equal(r.status, 200)
    // exactly what the table says is sardor's — other suites hold shops of
    // their own, so this is asked of the database rather than hardcoded
    const owned = psql(`select coalesce(string_agg(id::text, ',' order by id), '')
                          from stores where active and owner_id = '${U.sardor}'`).split(',').filter(Boolean)
    assert.deepEqual(codes(r.json).sort(), owned.sort())
    for (const id of [mine, second, oldDone, oldOpen]) assert.ok(codes(r.json).includes(id), id)
    assert.ok(!codes(r.json).includes(notMine))
  })

  test('the plan decorates that list without shortening it', async () => {
    // The plan used to BE the list. It is now a note on top of it: which day a
    // shop is wanted on. A shop with no plan row is still yours to visit — a
    // manager standing in one of their own shops on an unplanned day must not
    // be told it is not theirs.
    planRow(U.sardor, mine, today, week)
    const r = await menga(U.sardor)
    const row = r.json.find((s) => String(s.id) === mine)
    assert.equal(row.reja_sana, today)
    assert.equal(row.eski, false)
    assert.equal(r.json.find((s) => String(s.id) === second).reja_sana, null,
      'an unplanned shop must still be offered, just without a day')
    for (const id of [mine, second, oldDone, oldOpen]) assert.ok(codes(r.json).includes(id), id)
  })

  test('a task you never closed last week is still flagged as owed', async () => {
    planRow(U.sardor, oldOpen, past, past)
    const r = await menga(U.sardor)
    const row = r.json.find((s) => String(s.id) === oldOpen)
    assert.ok(row, "last week's unfinished task fell off the list")
    assert.equal(row.eski, true)
    assert.equal(row.bajarildi, false)
  })

  test('a task you did close last week stops being flagged, but the shop stays', async () => {
    planRow(U.sardor, oldDone, past, past)
    visitOn(U.sardor, oldDone, past)
    const r = await menga(U.sardor)
    const row = r.json.find((s) => String(s.id) === oldDone)
    assert.ok(row, 'a shop that is yours disappeared because its task was closed')
    assert.equal(row.reja_sana, null, 'a finished task is still being asked for')
  })

  test("somebody else's shop is not in yours", async () => {
    assert.ok(!codes((await menga(U.sardor)).json).includes(notMine))
    assert.ok(codes((await menga(U.otabek)).json).includes(notMine))
  })

  test('nothing assigned means an empty list, not everyone else\'s', async () => {
    const r = await menga(U.komil)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, [])
  })

  test('and the form cannot get at the rest of them', async () => {
    // the full store table is still readable — the admin screens list it — but
    // the shop the form will accept is only ever one of yours
    const full = await req('/api/stores', { as: U.sardor })
    assert.ok(codes(full.json).includes(notMine), 'the admin list lost a shop')
    const r = await req('/api/visits', {
      as: U.sardor, method: 'POST', body: { store_id: Number(notMine) },
    })
    assert.equal(r.status, 403)
  })
})

describe('regions', () => {
  // db/25 and db/26. The region is the first two digits of a store code: 40 is
  // Farg'ona, 0104 Chilonzor is district 04 of region 01. The team reads it
  // that way by eye and the export is split on it, so it is worth pinning down.
  test('there are fourteen regions and no catch-all', () => {
    assert.equal(psql('select count(*) from regions'), '14')
    assert.equal(psql("select count(*) from regions where code = 'XX'"), '0',
      'the Boshqa bucket is back')
  })

  test('a shop that cannot be placed has no region rather than a wrong one', () => {
    // db/26: abroad (KR, KZ, RUS, MISR) and shops with no location at all.
    // Inventing a region for them would put a shop nobody can visit on a
    // region head's tab.
    const stranded = psql(`select coalesce(string_agg(code, ', ' order by code), '')
                             from stores where active and region_code is null`)
    // every one of them must genuinely have nothing to go on
    for (const code of stranded.split(', ').filter(Boolean)) {
      assert.equal(psql(`select region_code_of(${"'"}${code.replace(/'/g, "''")}${"'"},
        (select territory from stores where code = '${code.replace(/'/g, "''")}'))`), '',
        `${code} could have been placed and was not`)
    }
  })

  test('every shop that CAN be placed is placed', () => {
    assert.equal(psql(`select count(*) from stores s
                        where s.active
                          and s.region_code is null
                          and region_code_of(s.code, s.territory) is not null`), '0')
  })

  test('the region comes off the code, and the territory wins when they differ', () => {
    const q = (v) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`)
    const of = (code, terr) => psql(`select region_code_of(${q(code)}, ${q(terr)})`)
    assert.equal(of('0104 Zumar KTD', "0104 Chilonzor"), '01', 'a Tashkent district is region 01')
    assert.equal(of('4015 Al-Hidoya KTD', "40 Farg'ona"), '40')
    assert.equal(of('KG Diyora KTD', '50 Namangan'), '50',
      'a shop whose code is not a number is placed by its territory')
    // a shop coded by its phone number: the digits are not a region
    assert.equal(of('998905863097', "40 Farg'ona"), '40')
    assert.equal(of('AMAL store', null), '', 'nothing to go on means no region, not a bucket')
    assert.equal(of('KZ Davron KTD', null), '', 'a shop abroad is in no Uzbek region')
  })

  test('a shop cannot be given a region by hand', () => {
    // it is derived by a trigger, so an import can never forget to set it and
    // nobody can quietly move a shop to another region head's tab
    const id = psql("select min(id) from stores where active and region_code = '40'")
    // '01' is a real region, so nothing but the trigger stands in the way
    psql(`update stores set region_code = '01' where id = ${id}`)
    assert.equal(psql(`select region_code from stores where id = ${id}`), '40',
      'a hand-written region_code stuck')
  })

  test('the region list counts shops and names who holds them', async () => {
    const r = await req('/api/regions', { as: U.komil })
    assert.equal(r.status, 200)
    assert.equal(r.json.length, Number(psql('select count(*) from regions')))
    const total = r.json.reduce((a, g) => a + Number(g.dokonlar), 0)
    // every active shop except the ones with no region at all
    assert.equal(total, Number(psql('select count(*) from stores where active and region_code is not null')))
  })

  test('the shops with no region are listed so the sheet can be fixed', () => {
    assert.equal(psql('select count(*) from v_hududsiz'),
                 psql('select count(*) from stores where active and region_code is null'))
  })

  test('an admin hands a whole region over in one call, and a manager cannot', async () => {
    const code = psql(`select region_code from stores where active and region_code is not null
                        group by region_code order by count(*) desc limit 1`)
    const n = Number(psql(`select count(*) from stores where active and region_code = '${code}'`))
    const saved = psql(`select coalesce(string_agg(id || ':' || coalesce(owner_id::text, ''), ','), '')
                          from stores where active and region_code = '${code}'`)

    const no = await req('/api/stores', {
      as: U.sardor, method: 'PATCH', body: { hudud: code, owner_id: U.sardor },
    })
    assert.equal(no.status, 403)

    const ok = await req('/api/stores', {
      as: U.komil, method: 'PATCH', body: { hudud: code, owner_id: U.malika },
    })
    assert.equal(ok.status, 200)
    assert.equal(ok.json.updated, n)
    assert.equal(psql(`select count(*) from stores where active and region_code = '${code}'
                        and owner_id = '${U.malika}'`), String(n))

    for (const pair of saved.split(',').filter(Boolean)) {
      const [id, owner] = pair.split(':')
      psql(`update stores set owner_id = ${owner ? `'${owner}'` : 'null'}::uuid where id = ${id}`)
    }
  })
})

describe('plans that repeat', () => {
  let week, thu, a, b, c

  const ids = () => [a, b, c].join(',')
  const clean = () => psql(`delete from plan_rules where store_id in (${ids()});
    delete from week_plans where store_id in (${ids()});
    delete from visits where store_id in (${ids()})`)
  const rules = (method, body, as = U.komil) => req('/api/plan/rules', { as, method, body })
  const dates = (store) => psql(`select coalesce(string_agg(to_char(visit_date,'YYYY-MM-DD'), ',' order by visit_date), '')
    from week_plans where store_id = ${store}`).split(',').filter(Boolean)
  const gap = (x, y) => Math.round((new Date(y) - new Date(x)) / 864e5)

  before(() => {
    week = psql('select week_of()::text')
    thu = psql('select (week_of() + 3)::text')          // Thursday of this week
    ;[a, b, c] = psql("select string_agg(id::text, ',' order by id) from (select id from stores where active order by id offset 31 limit 3) x").split(',')
    clean()
  })
  after(clean)

  test('a fortnightly Thursday rule fills the board forward', async () => {
    const r = await rules('POST', { sanalar: [thu], user_id: U.sardor, store_ids: [Number(a)], takror: 'ikki_hafta' })
    assert.equal(r.status, 200)
    assert.equal(r.json.rules, 1)
    assert.ok(r.json.planned >= 3, `only ${r.json.planned} tasks placed`)

    const d = dates(a)
    assert.ok(d.every((x) => new Date(x).getUTCDay() === 4), 'not every task is a Thursday')
    for (let i = 1; i < d.length; i++) assert.equal(gap(d[i - 1], d[i]), 14, 'not a fortnight apart')
  })

  test('nothing is ever written into the past', () => {
    assert.equal(psql(`select count(*) from week_plans where store_id = ${a} and visit_date < current_date`), '0')
  })

  test('the board says which tasks came from a rule', async () => {
    const r = await req(`/api/plan?hafta=${week}`, { as: U.komil })
    const row = r.json.rows.find((x) => String(x.store_id) === a)
    if (row) assert.ok(row.rule_id, 'a generated task is not marked as one')
    assert.equal(psql(`select count(*) from week_plans where store_id = ${a} and rule_id is null`), '0')
  })

  test('a manager cannot make a rule, and a bad cadence is refused', async () => {
    assert.equal((await rules('POST', { sanalar: [thu], user_id: U.sardor, store_ids: [Number(b)], takror: 'haftada' }, U.sardor)).status, 403)
    assert.equal((await rules('POST', { sanalar: [thu], user_id: U.sardor, store_ids: [Number(b)], takror: 'kuniga' })).status, 400)
  })

  test('a generated task that is removed stays removed', async () => {
    const before = dates(a)
    const victim = before[before.length - 1]
    assert.equal((await req('/api/plan', { as: U.komil, method: 'DELETE', body: { sana: victim, store_ids: [Number(a)] } })).status, 200)
    assert.ok(!dates(a).includes(victim))

    const top = await rules('POST', { tuldirish: true })
    assert.equal(top.status, 200)
    assert.ok(!dates(a).includes(victim), 'the rule put back a day an admin removed')
  })

  test('a generated task that is moved stays moved', async () => {
    const from = dates(a)[0]
    const to = psql(`select ('${from}'::date - 1)::text`)   // Wednesday of the same week
    const r = await req('/api/plan', { as: U.komil, method: 'PATCH', body: { store_id: Number(a), sana: from, yangi_sana: to } })
    assert.equal(r.status, 200)
    assert.equal(psql(`select rule_id from week_plans where store_id = ${a} and visit_date = '${to}'`), '',
      'a hand-moved task still belongs to its rule')

    await rules('POST', { tuldirish: true })
    assert.ok(!dates(a).includes(from), 'the rule refilled the day a task was moved off')
    assert.ok(dates(a).includes(to), 'the moved task disappeared')
  })

  test('once a month lands on the first such weekday of the month', async () => {
    const r = await rules('POST', { sanalar: [thu], user_id: U.sardor, store_ids: [Number(c)], takror: 'oy' })
    assert.equal(r.status, 200)
    const d = dates(c)
    assert.ok(d.length > 0, 'a monthly rule placed nothing at all')
    assert.ok(d.every((x) => Number(x.slice(8, 10)) <= 7), `not all first-of-month: ${d}`)
    assert.ok(d.every((x) => new Date(x).getUTCDay() === 4))
  })

  test('deleting a rule clears what is ahead and leaves the past alone', async () => {
    const ruleId = psql(`select id from plan_rules where store_id = ${c} limit 1`)
    // a task from before today that the rule placed back when it was in date
    psql(`insert into week_plans (week_start, visit_date, store_id, user_id, rule_id)
          values (week_of() - 7, week_of() - 4, ${c}, '${U.sardor}', ${ruleId})`)

    const r = await rules('DELETE', { id: Number(ruleId) })
    assert.equal(r.status, 200)
    assert.ok(r.json.removed >= 1)
    assert.equal(psql(`select count(*) from week_plans where store_id = ${c} and visit_date >= current_date`), '0')
    assert.equal(psql(`select count(*) from week_plans where store_id = ${c} and visit_date < current_date`), '1')
    assert.equal(psql(`select count(*) from plan_rules where id = ${ruleId}`), '0')
  })
})

describe('the main screen counts your own plan', () => {
  let today, s1, s2

  const clean = () => psql(`delete from week_plans where store_id in (${s1},${s2});
    delete from visit_books where visit_id in (select id from visits where store_id in (${s1},${s2}));
    delete from visits where store_id in (${s1},${s2})`)
  const home = async (as) => (await req('/', { as })).text

  before(() => {
    today = psql('select current_date::text')
    ;[s1, s2] = psql("select string_agg(id::text, ',' order by id) from (select id from stores where active order by id offset 61 limit 2) x").split(',')
    clean()
  })
  after(clean)

  test('with nothing planned it says so, instead of showing a number', async () => {
    assert.match(await home(U.sardor), /biriktirilmagan/)
  })

  test('it counts the shops planned for you, not every overdue shop', async () => {
    const r = await req('/api/plan', { as: U.komil, method: 'POST',
      body: { sana: today, user_id: U.sardor, store_ids: [Number(s1), Number(s2)] } })
    assert.equal(r.status, 200)
    assert.match(await home(U.sardor), /<em>2(<!-- -->)? ta<\/em>/)
    // the old headline came from v_bugungi_reja and read the same for everyone
    assert.ok(!/<em>2(<!-- -->)? ta<\/em>/.test(await home(U.otabek)),
      "another manager sees someone else's count")
  })

  test('a visit takes one off the count and shows up in the line below', async () => {
    psql(`insert into visits (manager_id, store_id, visited_at) values ('${U.sardor}', ${s1}, now())`)
    const html = await home(U.sardor)
    assert.match(html, /<em>1(<!-- -->)? ta<\/em>/)
    assert.match(html, /2 ta do&#x27;kon biriktirilgan, 1 tasiga borildi/)
  })
})
