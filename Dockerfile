FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile

ARG VITE_SERVER_URL
ARG VITE_WEB_URL
ARG VITE_APP_NAME=Watchbox
ENV VITE_SERVER_URL=$VITE_SERVER_URL
ENV VITE_WEB_URL=$VITE_WEB_URL
ENV VITE_APP_NAME=$VITE_APP_NAME

RUN pnpm --filter web build && pnpm --filter server build && pnpm --filter worker build

FROM oven/bun:1.3.14-debian AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

ENV NODE_ENV=production

FROM runtime AS web

EXPOSE 3001

CMD ["bun", "run", "--cwd", "apps/web", "serve", "--", "--host", "0.0.0.0", "--port", "3001"]

FROM runtime AS server

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD bun -e "fetch('http://127.0.0.1:3000/').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["bun", "apps/server/dist/index.mjs"]

FROM runtime AS worker

CMD ["bun", "apps/worker/dist/index.mjs"]

FROM runtime AS migrate

CMD ["bun", "run", "--cwd", "packages/db", "db:migrate"]
