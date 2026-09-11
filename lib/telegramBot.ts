import { sql } from 'drizzle-orm'
import { asSystem } from '@/lib/db'

const API = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await fetch(API(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    })
    const j = (await r.json()) as { ok: boolean; result?: T }
    return j.ok ? (j.result ?? null) : null
  } catch {
    return null
  }
}

export function sendMessage(chatId: number, text: string) {
  return call('sendMessage', { chat_id: chatId, text })
}

type Update = {
  update_id: number
  message?: {
    chat: { id: number }
    from?: { id: number; first_name?: string; last_name?: string; username?: string }
    text?: string
  }
}

/**
 * Pull whatever the bot has received and claim any login nonces in it.
 *
 * getUpdates is single-consumer: two overlapping calls get a 409 and one set of
 * updates is lost. Mutual exclusion is a LEASE on telegram_cursor rather than a
 * pg advisory lock, because a drain spans several HTTP round trips and an
 * advisory lock would mean holding a pooled owner connection across all of
 * them — two of those at once drains the pool and unrelated queries hang.
 *
 * Nothing here holds a database connection across a network call.
 */
export async function drainUpdates(): Promise<void> {
  // 1. take the lease, and with it the cursor
  const offset = await asSystem(async (db) => {
    const r = await db.execute(sql`
      update telegram_cursor
         set locked_until = now() + interval '30 seconds'
       where id and (locked_until is null or locked_until < now())
      returning update_id`)
    return r.rows.length ? Number((r.rows[0] as { update_id: string }).update_id) : null
  })
  if (offset === null) return // another drain holds it

  try {
    // 2. ask Telegram, holding nothing
    const updates = await call<Update[]>('getUpdates', {
      offset: offset + 1,
      timeout: 0,
      allowed_updates: ['message'],
    })
    if (!updates?.length) return

    for (const u of updates) {
      const text = (u.message?.text ?? '').trim()
      const sender = u.message?.from
      const from = sender?.id
      const chat = u.message?.chat.id
      if (!from || !chat) continue

      const shown =
        [sender?.first_name, sender?.last_name].filter(Boolean).join(' ') ||
        sender?.username ||
        String(from)

      const nonce = /^\/start\s+([a-f0-9]{32})$/.exec(text)?.[1]

      // 3. one short database visit per update, then the reply
      const outcome = await asSystem(async (db) => {
        const who = await db.execute(sql`
          select full_name from users where telegram_id = ${from} and active`)
        const name = (who.rows[0] as { full_name: string } | undefined)?.full_name ?? null

        // An unknown account is a person waiting to be let in, not an error.
        // Record it once (their name may have changed since) so an admin has
        // something to approve, and so nobody has to find their own id.
        if (!name) {
          await db.execute(sql`
            insert into join_requests (telegram_id, username, display_name)
            values (${from}, ${sender?.username ?? null}, ${shown})
            on conflict (telegram_id) do update
              set username = excluded.username, display_name = excluded.display_name`)
        }

        if (!nonce) return { kind: 'noop' as const, name }

        // Ten minutes, once. An expired or already-used nonce claims nothing.
        const claim = await db.execute(sql`
          update login_tokens
             set telegram_id = ${from}, claimed_at = now()
           where nonce = ${nonce}
             and claimed_at is null
             and created_at > now() - interval '10 minutes'
          returning nonce`)
        if (!claim.rows.length) return { kind: 'stale' as const, name }
        return { kind: 'claimed' as const, name }
      })

      // Always answer. A bot that stays silent is indistinguishable from a
      // broken one, which is exactly how this looked before.
      if (outcome.kind === 'noop') {
        await sendMessage(chat, outcome.name
          ? `Salom, ${outcome.name}. Kirish uchun saytdagi “Telegram orqali kirish” tugmasini bosing.`
          : 'Salom! So‘rovingiz administratorga yuborildi. U sizni tasdiqlagach, saytdagi “Telegram orqali kirish” tugmasi orqali kira olasiz.')
      } else if (outcome.kind === 'stale') {
        await sendMessage(chat, 'Bu havola eskirgan. Saytda qaytadan “Telegram orqali kirish” ni bosing.')
      } else {
        await sendMessage(chat, outcome.name
          ? `Tasdiqlandi. Brauzerga qayting — kirdingiz, ${outcome.name}.`
          : 'So‘rovingiz administratorga yuborildi. U sizni tasdiqlagach, qaytadan urinib ko‘ring.')
      }
    }

    // 4. only now is the cursor allowed to move past them
    const last = Math.max(...updates.map((u) => u.update_id))
    await asSystem((db) => db.execute(sql`update telegram_cursor set update_id = ${last} where id`))
  } finally {
    await asSystem((db) => db.execute(sql`update telegram_cursor set locked_until = null where id`))
  }
}

/**
 * Keep the bot answering when nobody has the login page open.
 *
 * This deliberately does NOT live in instrumentation.ts: Next compiles that
 * file for the edge runtime as well, and pulling lib/db (and therefore pg)
 * into an edge bundle breaks the whole app with "Can't resolve 'fs'". Route
 * handlers and server components are node-only, so starting the loop from
 * there is safe. First request after a restart arms it; it then runs for the
 * life of the process.
 */
let polling = false
export function ensureBotPolling() {
  if (polling || !process.env.TELEGRAM_BOT_TOKEN) return
  polling = true
  const tick = async () => {
    try {
      await drainUpdates()
    } catch (e) {
      // A dropped connection to Telegram or the db must not kill the loop.
      console.error('[telegram] drain failed:', (e as Error).message)
    }
    setTimeout(tick, 2000)
  }
  setTimeout(tick, 500)
}
