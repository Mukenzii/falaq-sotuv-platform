import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export type TelegramAuth = {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  auth_date: number
  hash: string
}

const MAX_AGE_SECONDS = 86400

/**
 * Telegram signs the login payload with SHA256(bot_token) as the HMAC key.
 * Reject anything older than a day so a captured payload can't be replayed.
 */
export function verifyTelegramLogin(data: TelegramAuth, botToken: string): boolean {
  const { hash, ...rest } = data
  if (!hash || !botToken) return false

  const checkString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${(rest as Record<string, unknown>)[k]}`)
    .join('\n')

  const secret = createHash('sha256').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(checkString).digest('hex')

  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(hash, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false

  return Math.floor(Date.now() / 1000) - data.auth_date < MAX_AGE_SECONDS
}

export function displayName(d: TelegramAuth): string {
  return [d.first_name, d.last_name].filter(Boolean).join(' ') || d.username || String(d.id)
}
