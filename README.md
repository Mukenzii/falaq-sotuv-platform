# Falaq Nashr — store visit system

Field managers record bookstore visits. Hierarchy: direktor > sotuv_boshligi >
hudud_rahbari > sotuv_manager. Each person sees only themselves and their own team.

## Stack

- Next.js (App Router), PWA for offline visit entry
- PostgreSQL 16, self-hosted — hierarchy enforced by RLS in the database
- Drizzle ORM, always via `asUser()` in `lib/db.ts`
- MinIO for shelf photos, presigned uploads
- Telegram Login, no passwords

## Local setup

    cp .env.example .env          # fill in the Telegram and Google values
    docker compose up -d          # postgres on 5433, minio on 9000
    ./scripts/load.sh             # runs every db/*.sql in order
    npm run dev                   # http://localhost:4300

Ports: this project uses **4300** (app) and **4301** (the separated frontend
container). 80, 3000, 8000 and 8080 are deliberately avoided.

## Opening it from a phone on the same wifi

    npm run dev            # already listens on all interfaces

`next dev` prints the address it is reachable on; find it again with

    ipconfig getifaddr en0                 # e.g. 192.168.0.153
    echo "$(scutil --get LocalHostName).local"   # e.g. macbook-air-user.local

Prefer the `.local` name: the router hands out a new lease every so often and the
IP changes with it, but the mDNS name does not. Both work, including the dev
login — `.local` is a reserved link-local TLD, so allowing it does not weaken the
"never over a public hostname" rule.

Both the app (4300) and MinIO (9000) bind to every interface, so nothing else is
needed as long as the macOS firewall is off or node is allowed through. Photo
uploads work because the presigned URL is signed for the host the request arrived
on, not for `localhost` — leave `MINIO_PUBLIC_ENDPOINT` empty so it is derived
per request. Setting it pins every phone to one address.

Login is Telegram, and only Telegram, on every address — the login widget was
dropped precisely because it needs one registered domain. The browser mints a
nonce, you press START in @falaqreaderbot, the bot's update carries the nonce
back and the waiting page logs itself in.

There is deliberately no back door, so a database with no reachable Telegram
account in it locks everyone out. Point the direktor row at a real account
before you need it:

    docker compose exec -T db psql -U falaq_owner -d falaq \
      -c "update users set telegram_id = <id> where role = 'direktor';"

## Why compose and not Kubernetes

Three services on one node with a dozen users. Compose does this in 100 lines;
k8s would add a control plane, ingress, storage classes and secrets to manage,
and would still be a single point of failure on one VDS.

The MinIO console is bound to 127.0.0.1, so reach it over a tunnel:

    ssh -L 9001:127.0.0.1:9001 user@vds

Deployment steps are in **Deploying to a server** at the end of this file.

## The form

The visit form is not code. It is one JSON document per version in
`form_versions`, edited at `/admin/forma` and rendered by
`app/vizit/yangi/Renderer.tsx` — the same component the editor's preview uses,
so a preview cannot flatter a form that would behave differently in the field.

- Shape: `lib/form/types.ts` (`FormDoc` → sections → blocks). Twelve question
  types, plus title / image / video content blocks and real section boundaries
  with per-answer routing.
- Draft and published are separate rows. Publishing archives the previous
  published version instead of dropping it: `visits.form_version` records which
  document a response was filled under, and the response viewer reads *that*
  version, so a renamed or deleted question still labels old answers correctly.
- The 16 original questions stay as typed columns on `visits`. They appear as
  blocks carrying a `coreKey` — renameable, reorderable, required-toggleable,
  hideable, never deletable and never retypable, because the dashboards, the
  enums and the Sheets export are built on those columns. `lib/form/sanitize.ts`
  pins their type on the way in, whatever the request body says.
- Anything an admin adds is stored in `visit_answers(visit_id, block_key, value)`
  as jsonb and appears without a code change in the respondent form, in server
  validation, in `/vizit/[id]`, in `/admin/savollar`, in the CSV export
  (`/api/export/csv`) and in the Sheets export.
- Validation lives in `lib/form/answers.ts` and runs in both places: the browser
  calls it per keystroke and `POST /api/visits` calls it again, so a client that
  skips its own checks is held to the same rule rather than a looser one.
- Importing questions reads a published version (or a Google form through the
  Forms API, when the service account is configured and the form is shared with
  it) and inserts copies with fresh ids. Nothing writes back to the source.

## Rules

- Never call `asSystem()` inside a request handler — it turns RLS off.
- The app connects as `falaq_app`, not `falaq_owner`. RLS is forced, so the
  owner role would still be filtered, but `falaq_app` owns nothing by design.
- Seeds and migrations need BYPASSRLS or a superuser.
- `npm test` republishes the form while it runs and puts it back in an `after`
  hook. It also clears every visit — re-run `scripts/demo-data.sql` afterwards.

## Changing people and tokens

- Bot token and the bootstrap admin id live in `.env` only.
- Everything else — telegram ids, names, roles, who reports to whom — is edited
  in the admin panel. `db/03_seed.sql` holds placeholder people with fake
  `9000000xx` ids; only Komil's id is real.

## Deploying to a server

Everything runs in containers — postgres, minio, the Next app, and an nginx
that serves the frontend and proxies `/api`. Nothing else needs installing on
the box except Docker.

### 1. What the server needs

- Docker Engine with the compose plugin (`docker compose version`)
- Ports: whatever you choose for `WEB_PORT`, plus **9000** for MinIO. 9000 must
  be reachable by phones — they upload shelf photos straight to it, not through
  the app.
- About 2 GB of RAM. Postgres, MinIO and one Node process are all small; the
  build is the heaviest moment.

### 2. Get the code and the secrets

    git clone git@github.com:Mukenzii/falaq-sotuv-platform.git
    cd falaq-sotuv-platform
    cp .env.example .env.prod

Fill in **every** value in `.env.prod`. It is never committed — `.gitignore`
covers `.env.*`. Generate the secrets rather than inventing them:

    openssl rand -hex 32        # SESSION_SECRET
    openssl rand -hex 24        # DB_PASSWORD, APP_DB_PASSWORD, MINIO_PASSWORD

`APP_DB_PASSWORD` is not optional. `db/00_roles.sql` reads it to create the
application's database role; without it the role falls back to the development
password that is written down in this repository.

### 3. Start it

    docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

The first run creates the database volume and replays every `db/*.sql` in
order. That happens **only on an empty volume** — later migrations have to be
applied by hand (see below). Watch it come up:

    docker compose -f docker-compose.prod.yml --env-file .env.prod ps
    docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f app

All four services report `healthy` when it is ready. Then open
`http://SERVER:WEB_PORT/login`.

### 4. Who can get in

A fresh install has exactly **one** user: the direktor in `db/03_seed.sql`.
Change the telegram id in that file before the first start if it should be
somebody else. Everyone after that joins the real way — they press START in the
bot, and an admin approves them on `/admin/sozlash`. No telegram id is ever
typed by hand, and there is no password anywhere in the system.

If the seeded account is wrong and the database is already running:

    docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
      psql -U falaq_owner -d falaq \
      -c "update users set telegram_id = <id> where role = 'direktor';"

There is deliberately no back door, so do this before you need it.

### 5. Put TLS in front

The session cookie follows `X-Forwarded-Proto`: it is `Secure` over https and
plain over http, so the app works either way. Over plain http the session
travels in clear text, which is fine on a closed network and not fine on the
internet. For a real domain, terminate TLS in front (Caddy and nginx both do
this in a few lines), point it at `WEB_PORT`, and make sure it forwards
`Host` and `X-Forwarded-Proto` unchanged — the photo upload links and the login
redirect are both built from the request's own `Host`.

If your TLS terminator does not set `X-Forwarded-Proto`, set `COOKIE_SECURE=true`.

### 6. Updating a running deployment

    git pull
    docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

New `db/*.sql` files are **not** applied automatically — the init directory only
runs on an empty volume. Apply them yourself, in order:

    docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
      psql -v ON_ERROR_STOP=1 -U falaq_owner -d falaq < db/17_rename_mlrr_to_mml.sql

Every migration is written to be safe to re-run.

### 7. Backups

The data is one volume. Dump it on a schedule:

    docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
      pg_dump -U falaq_owner -d falaq | gzip > falaq-$(date +%F).sql.gz

Photos live in the `miniodata` volume; back that up too if the shelf photos
matter. Restoring is `gunzip -c … | psql -U falaq_owner -d falaq` into a fresh
volume, then start the stack.

### 8. Google Sheets

Both integrations use one service account — no OAuth, no consent screen.
Share the spreadsheet that receives visits with the service account as
**Editor**, and the must-list sheet as **Viewer**. A sheet that is not shared
returns `PERMISSION_DENIED` and the sync button says so.

Visits push themselves to Sheets as soon as they are saved; `/admin/sheets`
shows the last successful push and any error.

### 9. Things that will bite you

- **Do not run `scripts/demo-*.sql` against production.** They invent visits.
  They live in `scripts/`, never in `db/`, so nothing loads them automatically.
- **MinIO's 9000 must stay open to phones.** The upload URL is signed for the
  host the request arrived on, so it works from a laptop and a phone at once —
  leave `MINIO_PUBLIC_ENDPOINT` empty unless MinIO has its own fixed name.
- **Postgres is not published.** Only the app reaches it, over the compose
  network. MinIO's console is bound to loopback; reach it over an SSH tunnel.
