#!/bin/sh
# nginx refuses to start if an ssl_certificate file is missing, and certbot
# cannot get a real one until nginx is answering on :80. That is a deadlock, so
# put a self-signed certificate in place first and let certbot replace it.
set -e

CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  echo "[web] no certificate for ${DOMAIN} yet — generating a temporary self-signed one"
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:2048 -days 3 \
    -keyout "$CERT_DIR/privkey.pem" -out "$CERT_DIR/fullchain.pem" \
    -subj "/CN=${DOMAIN}" >/dev/null 2>&1
  echo "[web] browsers WILL warn until certbot issues the real one"
fi

# Pick up a renewed certificate without a restart: certbot writes the new files
# and nginx only reads them at startup or on reload.
( while sleep 12h; do nginx -s reload 2>/dev/null || true; done ) &

exec /docker-entrypoint.sh "$@"
