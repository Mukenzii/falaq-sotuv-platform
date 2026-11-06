# Falaq Sotuv — sotuv.falaq.uz

Field managers record bookstore visits from a phone. The office tracks the
weekly round, the must-have assortment (MML), and pushes everything to Google
Sheets. Sign-in is a login and a password, and accounts exist only because an
administrator made one.

## Deploying

Everything runs in containers: postgres, minio, the Next app, an nginx that
serves the frontend and terminates TLS, and certbot. Nothing else is installed
on the server.

### 1. Before you start

- A server with Docker Engine and the compose plugin
- **This stack does not touch 80 or 443.** Your server already runs other
  projects behind its own proxy; that proxy keeps the certificate for
  `sotuv.falaq.uz` and forwards to us. We publish exactly one port, on
  loopback.
- DNS for `sotuv.falaq.uz` pointing at the server, and a certificate in that
  proxy — both of which you already have for your other sites.
- About 2 GB of RAM.

### 2. Configure

    git clone git@github.com:Mukenzii/falaq-sotuv-platform.git
    cd falaq-sotuv-platform
    cp .env.example .env.prod

Fill in every value. It is never committed. Generate the secrets:

    openssl rand -hex 32        # SESSION_SECRET
    openssl rand -hex 24        # DB_PASSWORD, APP_DB_PASSWORD, MINIO_PASSWORD

Pick a free port — `WEB_PORT=4300` by default, since 80, 443, 3000, 8000 and
8080 are taken on this server.

Two that are easy to miss:

- `APP_DB_PASSWORD` — `db/00_roles.sql` reads it to create the application's
  database role. Without it the role falls back to the development password
  that is written down in this repository.
- `DOMAIN` — the upload links and the login redirect are built from it.

### 3. Point your proxy at it

The stack listens on `127.0.0.1:$WEB_PORT` and speaks plain HTTP. Two headers
must arrive intact or things break in ways that are hard to trace: `Host`
(the photo-upload signature covers it) and `X-Forwarded-Proto` (the session
cookie is marked Secure from it).

nginx:

    server {
      listen 443 ssl;
      server_name sotuv.falaq.uz;
      # your existing certificate lines here

      client_max_body_size 50m;      # shelf photos

      location / {
        proxy_pass http://127.0.0.1:4300;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_request_buffering off;   # photos stream through
      }
    }

Caddy:

    sotuv.falaq.uz {
      reverse_proxy 127.0.0.1:4300
      request_body { max_size 50MB }
    }

Photo storage needs no rule of its own. MinIO is served as a path on the same
origin (`/falaq-photos/…`), so it inherits your TLS and there is no second
hostname, port or certificate to arrange.

### 4. Start

    docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

The first run creates the database volume and replays every `db/*.sql` in
order. Watch it settle:

    docker compose -f docker-compose.prod.yml --env-file .env.prod ps

All four services report `healthy`. Then open **https://sotuv.falaq.uz**.

### 5. The first sign-in

A fresh install has exactly **one** user: the direktor in `db/03_seed.sql`, and
that row has **no password**, so nobody can sign in yet. A password written
into a file in the repository is a password everybody has, so the first one is
set by hand, once, on the server:

    docker compose -f docker-compose.prod.yml -f docker-compose.caddy.yml --env-file .env \
      exec -T app node scripts/set-password.mjs komil '<parol>'

On a database that predates logins — where everybody still has a `telegram_id`
and nobody has a username — name the person as well, and they get both:

    ... node scripts/set-password.mjs komil '<parol>' Komil

`--list` prints everybody and whether they can sign in. Plain `node`, not
`npx tsx`: the script and the two plain-ESM modules it needs are copied into
the image (`Dockerfile`), and `pg` is already in the traced `node_modules`. Add `--temporary` to
make them choose a new password on arrival; the first direktor deliberately is
not forced to, because there is nobody to reset it for them if they get stuck.

Everyone after that is created by the direktor on **/admin/users**: a name, a
login, a starting password. They are made to replace that password the first
time they sign in. There is no sign-up, no email, and no "forgot my password" —
somebody locked out asks an admin, who presses **Parolni tiklash** and reads
them the new one. It is shown once and never again.

There is deliberately no back door, and no lockout either. An account is never
closed by failed attempts — the right password is always let straight through,
because a manager standing in a shop who mistypes once must not be shut out.
What a wrong password costs is time on the *next wrong one*: the delay climbs
0, 1, 2, 4, 8, 16, 30 seconds across consecutive misses and resets the moment
somebody signs in. Attempts running side by side are capped per IP by nginx
(`web/default.conf.template`), which is the layer that can see them.

### 6. Google Sheets

One service account, no OAuth and no consent screen. Share the spreadsheet
that **receives** visits with the service account as **Editor**, and the
must-list sheet as **Viewer**. A sheet that is not shared returns
`PERMISSION_DENIED`, and the sync button says so rather than failing quietly.

Visits push themselves as soon as they are saved; `/admin/sheets` shows the
last successful push and any error.

The push writes **one tab per region** plus the master tab holding every visit.
A region's tab is found by the **code its title starts with**: `40 Farg'ona`,
`40-Farg'ona` and `40 Fargona` are all region 40, so the words after the code
can be renamed freely — the code cannot. The master tab (the link's gid) never
counts as a region tab, even when it is named `01 …`. A region with no tab gets
one named `<code> <region>` (`80 Buxoro`) the first time it has a visit. A tab
that holds anything the export did not write itself is skipped, not
overwritten, and the **Jadvalga yuborish** button names it — so a tab someone
on the team keeps by hand is safe even if its title starts with a code.

### 7. Updating

    git pull
    docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

**Development handoff requirement:** always return the production Docker rebuild
command with development results. Run it from the existing production checkout
(its absolute server path is not recorded here), once the approved code is there.
Use `up -d --build`, not just `restart`, so both `app` and `falaq-sotuv-web` receive
code changes. Do not run it on the server without separate deployment authorization.
The Caddy helper creates a server-local override and uses `.env`; preserve that
configuration when the override exists:

```bash
if [ -f docker-compose.caddy.yml ]; then
  docker compose -f docker-compose.prod.yml -f docker-compose.caddy.yml --env-file .env up -d --build
else
  docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
fi
```

**New `db/*.sql` files are not applied automatically.** The init directory only
runs on an empty volume, so apply them yourself, in order:

    docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
      psql -v ON_ERROR_STOP=1 -U falaq_owner -d falaq < db/17_rename_mlrr_to_mml.sql

Every migration is written to be safe to re-run.

Then check production end to end at **`/admin/tekshiruv`** (admins only). Pick
a region and press **Testni boshlash**. In one to two minutes it:

1. opens a throwaway shop in that region (code `TEST-TEKSHIRUV-…`), owned by you;
2. files a visit with test answers through the same `POST /api/visits` a phone
   uses — every question of the published form, added ones included;
3. checks the row in the database and waits for the automatic Sheets push;
4. checks the visit is in the master tab and the region's tab, and nowhere else;
5. deletes the visit, its photo and the shop, pushes again and checks the row
   is gone from every tab.

Cleanup runs even when a step fails, and every run first sweeps anything a
previous run left behind. The deletion is not written to `deleted_visits`: a
test leaves no trace. If the push is paused on `/admin/sheets`, the Sheets
steps fail and say so.

### 8. Backups

    docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
      pg_dump -U falaq_owner -d falaq | gzip > falaq-$(date +%F).sql.gz

Photos live in the `miniodata` volume; back that up too if they matter.
Restore with `gunzip -c … | psql -U falaq_owner -d falaq` into a fresh volume.

### 9. What is exposed, and what is not

| port | what |
|---|---|
| `127.0.0.1:$WEB_PORT` | the whole application, plain HTTP, for your proxy |
| `127.0.0.1:9001` | MinIO console — `ssh -L 9001:127.0.0.1:9001 user@server` |
| — | postgres, MinIO's API, the Next app: never published |

Nothing binds a public interface. 80, 443 and 9000 are left alone for the
other projects on the server.

### 10. Things that will bite you

- **Never run `scripts/demo-*.sql` against production.** They invent visits.
  They live in `scripts/`, never in `db/`, so nothing loads them automatically.
- **Leave `MINIO_PUBLIC_ENDPOINT` empty.** It defaults to `https://$DOMAIN`,
  and storage is served as a path on that same origin. An upload link is signed
  over the hostname *and the path*, so a wrong value breaks photo upload with a
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
- Login and password, scrypt from `node:crypto` — no auth dependency, no
  identity provider, no registered domain needed

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

## Regions and who visits what

A **region** is one of Uzbekistan's 14 administrative units. It is the first two
digits of the store code: `40` is Farg'ona, and `0104 Chilonzor` is district
`04` of region `01`, Toshkent shahri. The 4-digit prefix is a *district* —
there are 120 of them — and is not what anyone is given.

There is no catch-all region (db/26 removed the `Boshqa` one db/25 had). A shop
either belongs to a real region or has **no region at all**, and `region_code`
is nullable to say so. Two kinds of shop have none:

- **Abroad** — KR, KZ, RUS, MISR. Nobody can visit them, so nobody is given
  them and they are not tracked. They are left alone, not filed somewhere.
- **No location yet** — mostly online shops, plus a few whose code was never
  filled in. `select * from v_hududsiz` lists them; the fix is to give them a
  territory in the sheet and re-run the store import, after which the trigger
  places them. Nothing is invented to fill the gap.

A visit against a region-less shop still reaches the master tab in Sheets — it
simply has no region tab to go in. It is never dropped.

`region_code_of(code, territory)` derives it, preferring the sheet's territory
column because it is right even where the code is not (one shop is coded by its
phone number, and the KG shops are served out of Namangan). A trigger keeps
`stores.region_code` in step, so an import cannot forget to set it and nobody
can move a shop to another region's tab by hand.

**Assignment is `stores.owner_id` and nothing else.** A manager sees only their
own shops in the new-visit form, and `v_insert` refuses a visit filed against
any other shop — the route answers 403 first so it can name the shop, but the
policy stands on its own. `users.region_code` only records which region someone
works; handing the shops over is the **Biriktirish** button on `/admin/users`,
which is a bulk `PATCH /api/stores {hudud, owner_id}`. Run it again after a
store import and the region's new shops are covered.

This reverses db/16, which had dropped ownership on the grounds that any shop
could be given to anyone. That is not how the team works: one region per
person.

Consequences worth knowing:

- A person with no shops assigned cannot file any visit. That includes a
  `direktor` — the gate is on the shop, not the role. Assign yourself a shop
  before testing, or exempt `can_manage_users()` in `v_insert` (db/25).
- Deactivating someone leaves their shops pointing at them. Hand the region to
  their replacement, or those shops go unvisitable.
- `/admin/reja` still plans any shop for any person. Planning a shop for
  someone who does not own it now produces a task they cannot close — the plan
  says *when*, ownership says *whether*. Assign the region first.

### Region heads (db/33)

A **hudud_rahbari** runs any number of regions — ticked in the Hudud column of
`/admin/users` and stored in `user_regions`. A manager still has exactly one,
in `users.region_code`.

A head's workers are the **managers whose region is one of the head's
regions**, whoever they report to. On `/admin/reja` a head adds, moves, hands
over and removes tasks and repeating rules for those workers, for shops in
those regions, and for nobody and nothing else. `can_plan(worker, shop)` is
that rule, and every write policy on `week_plans`, `plan_rules` and
`plan_rule_skips` is that function — the route only asks `can_plan_any()` to
decide whether the board is editable at all. Admins plan everything, as before.

A head sees those workers in the user list, so their tasks show on the board;
what visits a head can open is unchanged (their branch). Someone who stops being
a head loses their regions in the same save.

## Staff self-edits (db/32)

Non-admin users can update only their own `full_name` and `phone`. Role,
Login identity, activity, hierarchy and region assignments require an admin.
The API rejects a request containing protected fields in full; a database
trigger independently enforces the same limit, protecting new columns by default.
Profile edits do not change a region head's assigned regions. Trusted owner
connections for sign-in and migrations still work.

Existing databases must apply `db/32_self_update_guard.sql`;
rebuilding the app alone does not install the database guard.

`tests/user-permissions.test.mjs` verifies API and direct-database enforcement.
It requires `TEST_DATABASE_URL`, `TEST_DATABASE_URL_OWNER`, `TEST_BASE` and
`SESSION_SECRET` for a disposable local instance. It creates and removes only
its own fixture users, and skips when the explicit test database URLs are absent.

### Offline verification

Run the API suite only in a disposable database: its existing setup deletes visits.
The server and test process must share the same local configuration and session
secret. Use an explicit `TEST_BASE`, and point `COMPOSE_FILE` at the disposable
database's Compose file because the API suite runs `docker compose exec db`.
No real Telegram or Google credentials are required for the signature and local
sync-state checks. In the test checkout only, set these synthetic values:

```dotenv
TELEGRAM_BOT_TOKEN=000000000:offline-fixture-not-a-real-bot-token
GOOGLE_SERVICE_ACCOUNT_EMAIL=offline-fixture@example.invalid
GOOGLE_PRIVATE_KEY=offline-fixture-not-a-valid-private-key
SHEETS_SPREADSHEET_ID=offline_fixture_spreadsheet_00000000
```

Both the server and the tests must run with the test-only external HTTP blocker:

```bash
export NODE_OPTIONS="--require=$(pwd)/tests/support/offline-network.cjs"
# Start the local dev server in one terminal with the same NODE_OPTIONS.
# Run suites sequentially: the API suite has destructive global fixture hooks.
node --test tests/api.test.mjs
node --test tests/user-permissions.test.mjs
node --test tests/mml.test.mjs   # pure: no server, database or network needed
```

The fake Telegram token exercises local HMAC verification. The deliberately
invalid Google key satisfies configuration presence only; pause and lease tests
assert the real database gates return 409 before any Google operation. External
HTTP is rejected, not mocked as successful. These checks do not verify live bot
delivery, Google authentication or writes to Sheets. Storage tests still upload
to the disposable local MinIO and verify the configured public origin/port.

## An agent's own plan (db/34)

A `sotuv_manager` sees their own plan in two places, read-only:

- **Home → "Mening rejam"**: this week and this calendar month, in the board's
  columns (Reja, Vaqtida, Kechikib, Qoldi, Borilmadi, %).
- **Home → "Haftalik reja"** (`/admin/reja`): their own Monday–Sunday board, with
  the same Haftalik / Oylik switch on the summary that admins and heads get.

A task counts in the month of its **planned day**; its status is still decided
inside its own week, as on the board. So a task planned for the 30th and visited
on the 1st of the next month (same week) is a late visit counted in the month it
was planned. `month_summary(date)` runs under the caller's RLS: an agent gets
their own row only, a head their regions' managers and branch, an admin everyone.

## MML: 1 required, 2 optional (db/35)

The "MML" tab is a matrix: one row per **book** with its book category
(`Kat.`: A++, A+, A, B, C, New), one column per **shop category**, and in each
cell a requirement code — **1** required, **2** optional, **0** not required (older
sheets). A code is a requirement, never a quantity.

    MML = required titles on the shelf / required titles

"On the shelf" is unchanged and is a yes/no fact, not a count: a hand-set
`store_stock` value if there is one, otherwise the last visit's "present" titles.
Optional titles never raise or lower MML and never appear as missing. Agents see
the shop's MML and its missing **required** titles on `/dokon/[id]` and, live as
they tick titles, in the visit form.

Every active store has a `holat` in `v_mml`; only `olchangan` carries a figure:
`ustun_yoq` (no matrix column for its type), `majburiy_yoq` (its column requires
nothing), `qoida_eskirgan` (see below), `olchanmagan` (not measured yet). A store
that requires nothing is shown with that state, never as 100%.

Two rules changed on purpose because the old ones contradicted the matrix:

- **Grade A++ no longer means "every title".** An A++ bookstore is measured by
  `Kitob do'kon (A)` like A+ and A; another A++ shop by its type's column. The old
  rule turned a 2 in the shop's own column into a required, "missing" title.
- **The 0,5 / 0,3 / 0,2 category shares are gone.** The importer refuses such a
  cell (or any value other than 0, 1, 2), naming it, and changes nothing. A share
  already stored keeps no code, and its column reads `qoida_eskirgan` with no
  figure until the sheet is pulled again.

**After deploying db/34 and db/35**, apply both (see §7), then press
**"Google Sheets'dan yangilash"** on `/admin/mml` once. db/35 prints a NOTICE if any
column still holds an old share. The import replaces every code in one
transaction, so a column moves from the old rule to the new one in a single step;
if the sheet has a bad cell, nothing changes and the message names the cell.

## Rules

- Never call `asSystem()` inside a request handler — it turns RLS off.
- The app connects as `falaq_app`, not `falaq_owner`. RLS is forced, so the
  owner role would still be filtered, but `falaq_app` owns nothing by design.
- Seeds and migrations need BYPASSRLS or a superuser.
- `npm test` republishes the form while it runs and puts it back in an `after`
  hook. It also clears every visit — re-run `scripts/demo-data.sql` afterwards.

## Changing people

- Names, logins, roles, who reports to whom, and passwords are all edited in
  the admin panel, on `/admin/users`.
- `db/03_seed.sql` holds the bootstrap direktor and nobody else. It is guarded
  on "no direktor exists yet", so replaying `db:load` against a live database
  does not create a second one.
- Passwords are never readable, only replaceable: the database stores an scrypt
  hash (`lib/password.ts`), and a new password exists in the clear for exactly
  the one response that hands it to the admin.
- `users.telegram_id` is still there as a note of who somebody used to be in
  the bot. Nothing reads it.

