FROM node:22-alpine AS builder

WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
  && pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm rebuild esbuild

COPY . .
RUN pnpm build:web && pnpm build:server

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PICTVERSE_PORT=3000

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist-web ./dist-web
COPY --from=builder /app/dist-server ./dist-server

EXPOSE 3000

CMD ["node", "dist-server/server/index.js"]
