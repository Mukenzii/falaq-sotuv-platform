# Build the SPA, then ship only the static files behind nginx. The runtime
# image has no node in it at all — it is a few hundred kilobytes of JS.
FROM node:22-alpine AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS run
# templates/ is expanded with envsubst by the nginx entrypoint before start
COPY default.conf.template /etc/nginx/templates/default.conf.template
ENV APP_UPSTREAM=app:3000
COPY --from=build /web/dist /usr/share/nginx/html
EXPOSE 80

# busybox wget is in nginx:alpine; this checks nginx itself, not the upstream
HEALTHCHECK --interval=15s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/login || exit 1
