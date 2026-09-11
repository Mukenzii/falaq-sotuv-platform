/** @type {import('next').NextConfig} */
export default {
  // Emits .next/standalone with a self-contained server.js and only the
  // node_modules it actually uses — the image is ~200MB instead of ~1GB.
  output: 'standalone',
  // A package-lock.json in the home directory makes Next guess the wrong root.
  outputFileTracingRoot: import.meta.dirname,

  // A cloudflare quick tunnel gives the Telegram login widget the real https
  // domain it insists on. Next dev otherwise refuses the cross-origin /_next
  // requests coming from that hostname. The tunnel name is random per restart,
  // so it is matched by wildcard. Dev only — ignored by next build.
  allowedDevOrigins: ['*.trycloudflare.com'],

  // `next build` and `next dev` share .next by default, so building while the dev
  // server runs corrupts its chunks and the browser dies with a webpack TypeError
  // even though SSR keeps returning 200. npm run build sets this to a separate dir.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
}
