# ── Build stage ────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Build tools for better-sqlite3 native compile
RUN apk add --no-cache python3 make g++

# Install workspace deps (root + all packages). Done in one step so
# npm can resolve the file:../core symlink.
COPY package.json package-lock.json ./
COPY packages/core/package.json       packages/core/package.json
COPY packages/service/package.json    packages/service/package.json
RUN npm ci --workspaces --include-workspace-root --ignore-scripts

# Bring in source for the two workspaces the service runtime needs
COPY packages/core    packages/core
COPY packages/service packages/service

# Build core first (service depends on it), then service
RUN npm run build -w @ritkey/core \
 && npm run build -w @ritkey/service

# Drop dev deps for the runtime layer
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ── Runtime stage ──────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# tini for clean PID 1 signal handling
RUN apk add --no-cache tini

COPY --from=builder /app/node_modules                   ./node_modules
COPY --from=builder /app/package.json                   ./package.json
COPY --from=builder /app/packages/core/dist             ./packages/core/dist
COPY --from=builder /app/packages/core/package.json     ./packages/core/package.json
COPY --from=builder /app/packages/service/dist          ./packages/service/dist
COPY --from=builder /app/packages/service/package.json  ./packages/service/package.json
COPY --from=builder /app/packages/service/node_modules  ./packages/service/node_modules

# Railway mounts a persistent volume at /data; everything else comes from env vars.
ENV DATABASE_PATH=/data/wallets.db
ENV PORT=3000

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/service/dist/index.js"]
