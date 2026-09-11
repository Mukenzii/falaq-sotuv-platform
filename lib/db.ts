import { Pool, type PoolClient } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

// Connects as falaq_app, which owns nothing and so is subject to RLS.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })

// falaq_owner has BYPASSRLS. Login has to find a user before any session exists,
// which RLS would otherwise hide, so it needs a connection policies don't apply to.
// max was 2 while login lookups were the only user; the Telegram drain is a
// second steady caller, and a pool this small starves the moment two overlap.
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 6 })

// drizzle() over a checked-out client, not the pool — the RLS session variable
// only holds for the connection the query actually runs on.
export type Tx = NodePgDatabase<typeof schema> & { $client: PoolClient }

/**
 * Every request goes through here. RLS reads app.user_id, and a pooled
 * connection can be reused across requests, so the variable has to be set
 * inside the same transaction as the query or one user sees another's rows.
 */
export async function asUser<T>(userId: string, fn: (db: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId])
    const out = await fn(drizzle(client, { schema }))
    await client.query('COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/**
 * Drizzle inlines a JS array in a sql`` template as a value list, so `[]`
 * becomes `()` and the statement fails to parse. Bind array columns as a
 * Postgres array literal instead, with an explicit ::type[] cast at the call site.
 */
export function pgArray(values: Array<string | number> | null | undefined): string {
  if (!values?.length) return '{}'
  const items = values.map((v) =>
    typeof v === 'number' ? String(v) : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
  )
  return `{${items.join(',')}}`
}

/**
 * Drizzle wraps driver errors, so the Postgres SQLSTATE is one level down.
 * Route handlers need it to tell "RLS said no" (42501) from a real fault.
 */
export function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } }
  return err?.code ?? err?.cause?.code
}

/** The database's own message (e.g. a RAISE from a trigger), not Drizzle's wrapper. */
export function pgMessage(e: unknown): string {
  const err = e as { message?: string; cause?: { message?: string } }
  return err?.cause?.message ?? err?.message ?? 'xatolik'
}

/** Bypasses RLS. Login lookup and migrations only — never inside a request handler. */
export async function asSystem<T>(fn: (db: Tx) => Promise<T>): Promise<T> {
  const client = await ownerPool.connect()
  try {
    return await fn(drizzle(client, { schema }))
  } finally {
    client.release()
  }
}
