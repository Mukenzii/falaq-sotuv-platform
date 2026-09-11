import { ensureBotPolling } from '@/lib/telegramBot'
import LoginClient from './Client'

// Telegram is the only way in. Arming the bot poller here means the first
// visit to the login screen after a restart is what wakes the bot up.
export default function LoginPage() {
  ensureBotPolling()
  return <LoginClient />
}
