# video-site

![Video page](assets/video-page.png)

## Features

- Video playback with up-next recommendations and playlist autoplay
- Categories, search, and comments
- Authentication via Better-Auth
- React + TanStack Start frontend, Hono API, PostgreSQL + Drizzle ORM
- Monorepo managed with Turborepo and pnpm

## Local development

```bash
pnpm install
pnpm docker:up
pnpm db:push
pnpm dev
```

Web: http://localhost:3001 · API: http://localhost:3000
