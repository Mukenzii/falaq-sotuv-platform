# Falaq Sotuv — sotuv.falaq.uz

Field managers record bookstore visits from a phone. The office tracks the
weekly round, the must-have assortment (MML), and pushes everything to Google
Sheets. Sign-in is a Telegram bot — there are no passwords in the system.

## Deploying

Everything runs in containers: postgres, minio, the Next app, an nginx that
serves the frontend and terminates TLS, and certbot. Nothing else is installed
on the server.

### 1. Before you start

- A server with Docker Engine and the compose plugin (`docker compose version`)
- **DNS first.** An A record for `sotuv.falaq.uz` must already point at the
  server. Let's Encrypt verifies over port 80; without the record the first
  start comes up on a self-signed certificate and browsers will warn.
- Ports **80**, **443** and **9000** open. 9000 is not optional: phones upload
  shelf photos straight to storage, and nginx serves it there under the same
  certificate.
- About 2 GB of RAM.

### 2. Configure

    git clone git@github.com:Mukenzii/falaq-sotuv-platform.git
    cd falaq-sotuv-platform
    cp .env.example .env.prod

Fill in every value in `.env.prod`. It is never committed. Generate the
secrets rather than inventing them:

    openssl rand -hex 32        # SESSION_SECRET
    openssl rand -hex 24        # DB_PASSWORD, APP_DB_PASSWORD, MINIO_PASSWORD

Two that are easy to miss:

- `APP_DB_PASSWORD` — `db/00_roles.sql` reads it to create the application's
  database role. Without it the role falls back to the development password
  that is written down in this repository.
- `LETSENCRYPT_EMAIL` — where expiry warnings go. certbot refuses without it.

### 3. Start

    docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

The first run creates the database volume and replays every `db/*.sql` in
order. nginx comes up immediately on a temporary self-signed certificate so it
can answer the Let's Encrypt challenge; certbot then issues the real one and
nginx picks it up within twelve hours, or immediately if you reload it:

    docker compose -f docker-compose.prod.yml --env-file .env.prod exec web nginx -s reload

Watch it settle:

    docker compose -f docker-compose.prod.yml --env-file .env.prod ps
    docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f certbot

All five services report `healthy`. Then open **https://sotuv.falaq.uz**.

### 4. The first sign-in

A fresh install has exactly **one** user: the direktor in `db/03_seed.sql`.
Change the telegram id there before the first start if it should be somebody
else. Everyone after that joins the real way — they press START in
`@falaqreaderbot`, a request appears on `/admin/sozlash`, and an admin approves
it. No telegram id is ever typed by hand.

There is deliberately no back door. If the seeded account is wrong and the
database is already running:

    docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
      psql -U falaq_owner -d falaq \
      -c "update users set telegram_id = <id> where role = 'direktor';"

### 5. Google Sheets

One service account, no OAuth and no consent screen. Share the spreadsheet
that **receives** visits with the service account as **Editor**, and the
must-list sheet as **Viewer**. A sheet that is not shared returns
`PERMISSION_DENIED`, and the sync button says so rather than failing quietly.

Visits push themselves as soon as they are saved; `/admin/sheets` shows the
last successful push and any error.

### 6. Updating

    git pull
    docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

**New `db/*.sql` files are not applied automatically.** The init directory only
runs on an empty volume, so apply them yourself, in order:

    docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
      psql -v ON_ERROR_STOP=1 -U falaq_owner -d falaq < db/17_rename_mlrr_to_mml.sql

Every migration is written to be safe to re-run.

### 7. Backups

    docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
      pg_dump -U falaq_owner -d falaq | gzip > falaq-$(date +%F).sql.gz

Photos live in the `miniodata` volume; back that up too if they matter.
Restore with `gunzip -c … | psql -U falaq_owner -d falaq` into a fresh volume.

### 8. What is exposed, and what is not

| port | what | why |
|---|---|---|
| 80 | certificate renewal, redirect to https | Let's Encrypt needs it |
| 443 | the application | |
| 9000 | photo storage over TLS | phones PUT straight to it |
| 9001 | MinIO console, **loopback only** | `ssh -L 9001:127.0.0.1:9001 user@server` |
| — | postgres | never published; only the app reaches it |

### 9. Things that will bite you

- **Never run `scripts/demo-*.sql` against production.** They invent visits.
  They live in `scripts/`, never in `db/`, so nothing loads them automatically.
- **Leave `MINIO_PUBLIC_ENDPOINT` empty.** It defaults to
  `https://sotuv.falaq.uz:9000`, which is where nginx serves storage. An upload
  link is signed over the hostname, so a wrong value breaks photo upload with a
  signature error rather than a clear one.
- **Leave `COOKIE_SECURE` empty.** The session cookie follows
  `X-Forwarded-Proto`. Hardcoding it wrong logs everybody out, silently.
- A TLS terminator in front of this one must pass `Host` through unchanged —
  the upload links and the login redirect are built from it.

## Stack

- Next.js (App Router), PWA for offline visit entry
- PostgreSQL 16, self-hosted — hierarchy enforced by RLS in the database
- Drizzle ORM, always via `asUser()` in `lib/db.ts`
- MinIO for shelf photos, presigned uploads
- Telegram bot login, no passwords and no registered domain needed

## Why compose and not Kubernetes

Three services on one node with a dozen users. Compose does this in 100 lines;
k8s would add a control plane, ingress, storage classes and secrets to manage,
and would still be a single point of failure on one VDS.

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

