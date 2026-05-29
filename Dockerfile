FROM node:22-alpine AS builder

WORKDIR /app

# Install build tools for better-sqlite3 native compile
RUN apk add --no-cache python3 make g++

# Install all deps (including dev) to compile
COPY package.json package-lock.json ./
RUN npm ci

# Copy source + build
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# Drop dev deps for the runtime layer
RUN npm prune --omit=dev

# ── Runtime ────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# better-sqlite3 needs nothing extra at runtime, but keep tini for clean PID 1
RUN apk add --no-cache tini

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Railway mounts a persistent volume at /data; .env vars provide everything else
ENV DATABASE_PATH=/data/wallets.db
ENV PORT=3000

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
