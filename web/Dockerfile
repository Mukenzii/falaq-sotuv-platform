# Build the SPA, then ship only the static files behind nginx. The runtime
# image has no node in it at all — it is a few hundred kilobytes of JS.
FROM node:22-alpine AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS run
RUN apk add --no-cache openssl
# templates/ is expanded with envsubst by the nginx entrypoint before start
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY entrypoint.sh /entrypoint.sh
ENV APP_UPSTREAM=app:3000 MINIO_UPSTREAM=minio:9000 DOMAIN=localhost
ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
COPY --from=build /web/dist /usr/share/nginx/html
EXPOSE 80 443 9000

# checks nginx itself, not the upstream. :80 always answers (it serves the ACME
# challenge and redirects), so this works before a certificate exists.
HEALTHCHECK --interval=15s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null --max-redirect=0 http://127.0.0.1/.well-known/acme-challenge/ \
      || wget -q -S -O /dev/null http://127.0.0.1/login 2>&1 | grep -q '301\|200' || exit 1
