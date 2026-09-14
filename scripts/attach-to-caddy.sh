#!/usr/bin/env bash
# Attach Falaq Sotuv to books_store_caddy and get https://sotuv.falaq.uz live.
# Safe to run more than once. Run on the server from the repo: bash scripts/attach-to-caddy.sh
APP=$(cd "$(dirname "$0")/.." && pwd)
CF=/home/mukenzi/book_store_bot/Caddyfile
C=books_store_caddy
cd "$APP" || { echo "no $APP"; exit 1; }
DC="docker compose -f docker-compose.prod.yml -f docker-compose.caddy.yml --env-file .env"

echo "== 1. .env"
[ -f .env ] || { [ -f .env.prod ] && mv .env.prod .env && echo "renamed .env.prod -> .env"; }
[ -f .env ] && echo ok || { echo "MISSING .env"; exit 1; }

echo "== 2. join Caddy's network"
cat > docker-compose.caddy.yml <<'YML'
services:
  web:
    networks:
      default: {}
      caddy:
        aliases: [falaq-sotuv-web]
networks:
  caddy:
    external: true
    name: book_store_bot_default
YML
$DC up -d 2>&1 | tail -5
$DC ps --format '{{.Service}}  {{.Status}}'

echo "== 3. can Caddy reach the app? (want 200 OK)"
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
echo "--- last 12 lines of Caddyfile:"
tail -12 "$CF"

echo "== 5. does the Caddy CONTAINER see it?"
if docker exec $C grep -q 'sotuv.falaq.uz' /etc/caddy/Caddyfile; then echo yes
else echo "NO -> the container sees an old copy. Run: docker restart $C   (books_store blinks ~2s)"; fi

echo "== 6. validate + reload"
if docker exec $C caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/tmp/caddy-validate.txt 2>&1; then
  if docker exec $C caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/tmp/caddy-reload.txt 2>&1; then
    echo reloaded
  else
    echo "RELOAD FAILED -> run: docker restart $C"; tail -3 /tmp/caddy-reload.txt
  fi
else
  echo "VALIDATE FAILED, nothing reloaded:"; tail -8 /tmp/caddy-validate.txt
fi

echo "== 7. waiting for the certificate (up to 90s)"
code=000
for i in $(seq 1 18); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://sotuv.falaq.uz/login)
  [ "$code" = 200 ] && break
  sleep 5
done
if [ "$code" = 200 ]; then echo "LIVE: https://sotuv.falaq.uz"
else echo "still not live (code $code). Caddy log:"; docker logs $C --since 10m 2>&1 | grep -iE 'sotuv|acme|challenge|error' | tail -20; fi
