# syntax=docker/dockerfile:1

# Deps are cached on package-lock alone, so editing app code does not reinstall.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Not `npm run build` — that script points distDir at .next-build so a local
# build cannot clobber a running dev server. In the image there is no dev server.
RUN npx next build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

# The first account cannot be made from the web app — making one needs an
# account — so the one script that breaks that circle has to be in here. It is
# plain ESM importing plain ESM, and pg is already in the traced node_modules
# that standalone brought with it, so this runs under `node` with nothing else
# installed:
#
#   docker compose ... exec -T app node scripts/set-password.mjs komil '<parol>' Komil
#
# Only this script is copied. The other files in scripts/ import .ts sources
# that a standalone image does not have, and shipping them would promise
# something that cannot work.
COPY --from=build --chown=nextjs:nodejs /app/scripts/set-password.mjs ./scripts/
COPY --from=build --chown=nextjs:nodejs /app/lib/passwordHash.mjs /app/lib/passwordRules.mjs ./lib/

USER nextjs
EXPOSE 3000

# No curl or wget in the slim image; node is already here.
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
