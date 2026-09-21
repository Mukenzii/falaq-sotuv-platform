import LoginClient from './Client'

// Nothing to arm here any more. This page used to start the Telegram bot
// poller, because the bot was the only way in; sign-in is now a form post and
// the page is static.
export default function LoginPage() {
  return <LoginClient />
}
