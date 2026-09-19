# syntax=docker/dockerfile:1
FROM oven/bun:1.4.0-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run build && bun run test

FROM oven/bun:1.4.0-alpine AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

FROM oven/bun:1.4.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3007
COPY --from=production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun package.json ./
COPY --chown=bun:bun server/index.ts server/app.ts server/router.ts server/model-criteria.ts server/request-log.ts ./server/
COPY --chown=bun:bun shared ./shared
USER bun
EXPOSE 3007
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e 'const r = await fetch("http://127.0.0.1:3007/api/health", { signal: AbortSignal.timeout(3000) }); if (!r.ok || !(await r.json()).configured) process.exit(1)'
CMD ["bun", "server/index.ts"]
