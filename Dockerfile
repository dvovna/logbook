# Node images from 26 on ship without yarn and corepack, so yarn 1 is installed explicitly.
FROM node:26-alpine AS builder
WORKDIR /app
RUN npm install -g yarn@1.22.22

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

FROM node:26-alpine AS runner
WORKDIR /app
RUN npm install -g yarn@1.22.22

# Production mode: info-level JSON logs instead of the pretty dev output.
ENV NODE_ENV=production
ENV PORT=10000

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
# The app checks at startup that the database has every migration it ships.
COPY --from=builder /app/supabase/migrations ./supabase/migrations

# Run as the image's unprivileged user rather than root.
USER node

CMD ["node", "dist/main.js"]
