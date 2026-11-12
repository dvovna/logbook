# Node images from 26 on ship without corepack, so pnpm is installed explicitly,
# at the version `packageManager` in package.json names. pnpm-workspace.yaml
# holds the overrides, without which the lockfile doesn't match.
FROM node:26-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")" \
  && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:26-alpine AS runner
WORKDIR /app

# Production mode: info-level JSON logs instead of the pretty dev output.
ENV NODE_ENV=production
ENV PORT=10000

# The app runs with node, so pnpm, its store and its cache go once it has installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")" \
  && pnpm install --frozen-lockfile --prod \
  && rm -rf "$(pnpm store path)" ~/.cache/pnpm \
  && npm uninstall -g pnpm

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
# The app checks at startup that the database has every migration it ships.
COPY --from=builder /app/supabase/migrations ./supabase/migrations

# Run as the image's unprivileged user rather than root.
USER node

# /health answers 503 when the database is out of reach.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

# Stack traces, in the logs and in Sentry, name the TypeScript line: the build
# keeps its source maps in dist.
CMD ["node", "--enable-source-maps", "dist/main.js"]
