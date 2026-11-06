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

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

ENV PORT=10000

CMD ["node", "dist/main.js"]
