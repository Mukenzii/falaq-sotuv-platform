/** Run against a disposable local database, with TEST_DATABASE_URL,
 * TEST_DATABASE_URL_OWNER, TEST_BASE and SESSION_SECRET set. No shared fixtures. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import pg from 'pg'
import 'dotenv/config'

const enabled = !!(process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL_OWNER)

test('staff self-edits preserve authorization and login identity', { skip: !enabled }, async (t) => {
  const base = process.env.TEST_BASE
  for (const url of [base, process.env.TEST_DATABASE_URL, process.env.TEST_DATABASE_URL_OWNER]) {
    assert.ok(url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
      'these tests require explicit loopback-only test endpoints')
  }
  assert.ok(process.env.SESSION_SECRET)
  const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL_OWNER })
  const app = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
  const ids = Array.from({ length: 4 }, () => randomUUID())
  const [director, boss, head, manager] = ids
  const roles = ['direktor', 'sotuv_boshligi', 'hudud_rahbari', 'sotuv_manager']
  const tg = -Math.floor(Date.now() + Math.random() * 1000000)
  const patch = async (actor, target, body) => {
    const sig = createHmac('sha256', process.env.SESSION_SECRET).update(actor).digest('base64url')
    return fetch(`${base}/api/users/${target}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: `falaq_session=${actor}.${sig}` },
      body: JSON.stringify(body), redirect: 'manual',
    })
  }
  const row = async (id) => (await owner.query('select * from users where id=$1', [id])).rows[0]
  const asApp = async (actor, query, args) => {
    const c = await app.connect()
    try {
      await c.query('begin')
      await c.query("select set_config('app.user_id',$1,true)", [actor])
      return await c.query(query, args)
    } finally {
      await c.query('rollback')
      c.release()
    }
  }
  try {
    for (let i = 0; i < ids.length; i++) {
      await owner.query(`insert into users (id, telegram_id, full_name, role, parent_id, region_code)
        values ($1,$2,'Permission fixture',$3,$4,'40')`,
      [ids[i], tg - i, roles[i], i ? ids[i - 1] : null])
    }
    await owner.query("insert into user_regions values ($1,'40')", [head])

    for (const actor of [manager, head]) {
      for (const body of [
        { role: 'direktor' }, { role: 'sotuv_boshligi' }, { username: `s${-tg}a` },
        { parent_id: director }, { region_code: '01' }, { active: false },
        { regions: ['40','01'] }, { regions: [] },
        { full_name: 'Must roll back', role: 'direktor' },
      ]) await t.test(`${roles[ids.indexOf(actor)]} cannot self-edit ${Object.keys(body).join(', ')}`, async () => {
        const before = await row(actor)
        const r = await patch(actor, actor, body)
        assert.equal(r.status, 403, await r.text())
        assert.deepEqual(await row(actor), before)
      })
    }

    await t.test('manager and head can edit their own name and phone without losing regions', async () => {
      for (const actor of [manager, head]) {
        const phone = `fixture-${actor}`
        const r = await patch(actor, actor, { full_name: 'Updated fixture', phone })
        assert.equal(r.status, 200, await r.text())
        assert.equal((await row(actor)).full_name, 'Updated fixture')
        assert.equal((await row(actor)).phone, phone)
      }
      assert.deepEqual((await owner.query('select region_code from user_regions where user_id=$1', [head])).rows,
        [{ region_code: '40' }])
    })

    await t.test('manager cannot edit another worker', async () => {
      const before = await row(head)
      assert.equal((await patch(manager, head, { full_name: 'No' })).status, 404)
      assert.deepEqual(await row(head), before)
    })

    await t.test('database itself rejects privilege and identity changes', async () => {
      for (const [column, value] of [
        ['role','direktor'], ['telegram_id',tg - 30], ['telegram_username','spoofed'],
        ['parent_id',director], ['region_code','01'], ['active',false], ['email','spoofed@example.invalid'],
        ['created_at','2000-01-01'], ['id',randomUUID()],
      ]) await assert.rejects(asApp(manager, `update users set ${column}=$1 where id=$2`, [value, manager]),
        { code: '42501' }, column)
      assert.equal((await asApp(manager, "update users set full_name='Allowed' where id=$1", [manager])).rowCount, 1)
    })

    await t.test('director and sales boss can still manage staff and head regions', async () => {
      for (const actor of [director, boss]) {
        const login = `s${-tg}${roles[ids.indexOf(actor)].slice(0, 2)}`
        const identity = await patch(actor, manager, { username: login, parent_id: boss, active: false })
        assert.equal(identity.status, 200, await identity.text())
        const saved = await row(manager)
        assert.equal(saved.username, login)
        assert.equal(saved.parent_id, boss)
        assert.equal(saved.active, false)
        assert.equal((await patch(actor, manager, { active: true })).status, 200)
        const r = await patch(actor, manager, { role: 'hudud_rahbari', regions: ['40','01'] })
        assert.equal(r.status, 200, await r.text())
        assert.equal((await row(manager)).role, 'hudud_rahbari')
        const back = await patch(actor, manager, { role: 'sotuv_manager', region_code: '40' })
        assert.equal(back.status, 200, await back.text())
        assert.equal((await owner.query('select * from user_regions where user_id=$1', [manager])).rowCount, 0)
      }
    })

    await t.test('trusted login/system updates remain possible', async () => {
      await owner.query("update users set telegram_username='login_fixture' where id=$1", [manager])
      assert.equal((await row(manager)).telegram_username, 'login_fixture')
    })
  } finally {
    // Only these UUIDs are ours; never clear visits or touch an existing user.
    for (const id of [...ids].reverse()) await owner.query('delete from users where id=$1', [id])
    await Promise.all([owner.end(), app.end()])
  }
})
