# ── Build stage ────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Build tools for better-sqlite3 (C++) and @ritkey/crypto (Rust NAPI)
RUN apk add --no-cache python3 make g++ rust cargo

# Install all workspace deps (root + workspaces). --ignore-scripts so napi
# postinstall doesn't try to fetch prebuilts that don't exist for our crate.
COPY package.json package-lock.json ./
COPY packages/core/package.json       packages/core/package.json
COPY packages/service/package.json    packages/service/package.json
COPY packages/crypto-rs/package.json  packages/crypto-rs/package.json
RUN npm ci --workspaces --include-workspace-root --ignore-scripts

# Build @ritkey/crypto — the Rust NAPI module. Must run before @ritkey/core
# compiles, since core imports from it.
COPY packages/crypto-rs packages/crypto-rs
RUN cd packages/crypto-rs && npm run build

# Build the TypeScript workspaces. core first (service depends on it).
COPY packages/core    packages/core
COPY packages/service packages/service
RUN npm run build -w @ritkey/core \
 && npm run build -w @ritkey/service

# Drop dev deps for the runtime layer
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ── Runtime stage ──────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# tini for clean PID 1 signal handling
RUN apk add --no-cache tini libgcc

COPY --from=builder /app/node_modules                            ./node_modules
COPY --from=builder /app/package.json                            ./package.json
COPY --from=builder /app/packages/core/dist                      ./packages/core/dist
COPY --from=builder /app/packages/core/package.json              ./packages/core/package.json
COPY --from=builder /app/packages/service/dist                   ./packages/service/dist
COPY --from=builder /app/packages/service/package.json           ./packages/service/package.json
# Native NAPI binary + JS shim for @ritkey/crypto
COPY --from=builder /app/packages/crypto-rs/index.js             ./packages/crypto-rs/index.js
COPY --from=builder /app/packages/crypto-rs/index.d.ts           ./packages/crypto-rs/index.d.ts
COPY --from=builder /app/packages/crypto-rs/package.json         ./packages/crypto-rs/package.json
COPY --from=builder /app/packages/crypto-rs/*.node               ./packages/crypto-rs/

# Railway mounts a persistent volume at /data; everything else comes from env vars.
ENV DATABASE_PATH=/data/wallets.db
ENV PORT=3000

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/service/dist/index.js"]
