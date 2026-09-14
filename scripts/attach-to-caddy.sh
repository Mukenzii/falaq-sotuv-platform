#!/usr/bin/env bash
# Attach Falaq Sotuv to books_store_caddy and get https://sotuv.falaq.uz live.
# Safe to run more than once. Run on the server from the repo: bash scripts/attach-to-caddy.sh
APP=$(cd "$(dirname "$0")/.." && pwd)
CF=/home/mukenzi/book_store_bot/Caddyfile
C=books_store_caddy
cd "$APP" || { echo "no $APP"; exit 1; }
DC="docker compose -f docker-compose.prod.yml -f docker-compose.caddy.yml --env-file .env"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

echo "== 1. .env"
[ -f .env ] || { [ -f .env.prod ] && mv .env.prod .env && echo "renamed .env.prod -> .env"; }
[ -f .env ] && echo ok || { echo "MISSING .env"; exit 1; }

echo "== 2. join Caddy's network (only falaq-sotuv-web joins it)"
cat > docker-compose.caddy.yml <<'YML'
services:
  falaq-sotuv-web:
    networks:
      default: {}
      caddy: {}
networks:
  caddy:
    external: true
    name: book_store_bot_default
YML
# --remove-orphans removes the old container of the service formerly called "web"
$DC up -d --remove-orphans 2>&1 | tail -8
$DC ps --format '{{.Service}}  {{.Status}}'

echo "== 3. can Caddy reach Falaq? (want 200 OK)"
docker exec $C wget -qS -O /dev/null http://falaq-sotuv-web/login 2>&1 | head -1

echo "== 4. site block in Caddyfile"
if grep -q 'sotuv.falaq.uz' "$CF"; then
  echo "already there"
elif [ ! -w "$CF" ]; then
  echo "NO WRITE PERMISSION on $CF -> run: sudo bash $0"; exit 1
else
  cp "$CF" "$CF.bak-$(date +%F-%H%M)"
  cat >> "$CF" <<'CADDY'

sotuv.falaq.uz {
    request_body {
        max_size 50MB
    }
    reverse_proxy falaq-sotuv-web:80
}
CADDY
  echo "added (backup saved next to it)"
fi

echo "== 5. does the Caddy CONTAINER see it?"
if docker exec $C grep -q 'sotuv.falaq.uz' /etc/caddy/Caddyfile; then echo yes
else echo "NO -> run: docker restart $C   (books_store blinks a few seconds), then run this script again"; exit 1; fi

echo "== 6. validate + reload"
if docker exec $C caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >"$TMP" 2>&1; then
  if docker exec $C caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >"$TMP" 2>&1; then
    echo reloaded
  else
    echo "RELOAD FAILED -> run: docker restart $C"; tail -3 "$TMP"
  fi
else
  echo "VALIDATE FAILED, nothing reloaded:"; tail -8 "$TMP"
fi

echo "== 7. is it FALAQ that answers? (up to 90s)"
title=""
for i in $(seq 1 18); do
  title=$(curl -sL --max-time 8 https://sotuv.falaq.uz/ | tr '\n' ' ' | grep -oE '<title>[^<]*' | head -1 | sed 's/<title>//')
  case "$title" in *Falaq*) break ;; esac
  sleep 5
done
case "$title" in
  *Falaq*) echo "LIVE: https://sotuv.falaq.uz  (page title: $title)" ;;
  *) echo "NOT OK: the site answers with title '$title'"; docker logs $C --since 10m 2>&1 | grep -iE 'sotuv|acme|error' | tail -15 ;;
esac
