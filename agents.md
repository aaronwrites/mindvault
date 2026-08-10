# MindVault

AI-powered personal knowledge management platform for users. Goes beyond a bookmark manager: captures resources from multiple sources, enriches them with AI-generated summaries/tags/embeddings, and makes them retrievable via semantic search instead of manual folders.

Built solo — as both a portfolio piece and a university project proposal.

## Stack

- **Runtime**: Bun
- **Backend**: Express + TypeScript
- **ORM**: Drizzle (raw SQL access for pgvector queries, no generated client)
- **Database**: PostgreSQL 18 (`pgvector/pgvector:pg18` Docker image), pgvector extension for embeddings
- **Queue**: BullMQ + Redis (planned — not yet implemented)
- **Object storage**: Cloudinary (planned — not yet implemented; only needed for uploaded files like PDFs/screenshots)
- **AI**: Gemini API free tier (Flash model) via Google AI Studio
- **Frontend**: Next.js + shadcn/ui (kept at defaults for now — visual polish deferred until backend is solid)
- **Validation**: Zod
- **Future**: browser extension (after core web app is complete), built as a thin client against the same API

## Structure

```
mindvault/
  api/               Express API
    src/
      controllers/      Request handlers — business logic lives here
      routes/           Express routers — map paths to controllers only, no logic
      schemas/          Zod validation schemas
      db/
        schema.ts       Drizzle table definitions
        index.ts         DB client (Drizzle + pg Pool)
        seed.ts          Dev-only seed script
    drizzle.config.ts
    drizzle/             Generated migrations
  client/               Next.js frontend using shadcn/ui components
  docker-compose.yml     Postgres (pgvector) + Redis
  AGENTS.md
  context.md
```

## Conventions

- Routes contain **no logic** — they only wire `path -> controller function`.
- Controllers hold request/response handling and call into `db` directly for now (no separate service/repository layer yet — add one only if controllers start getting complex).
- Use Drizzle's query builder directly for pgvector similarity queries (`ORDER BY embedding <=> $1`) rather than working around it — this is the main reason Drizzle was chosen over Prisma.
- No monorepo tooling (no Turborepo/Nx/pnpm workspaces). `api/` and `client/` are plain sibling folders, each with their own `package.json`. Revisit only if type-sharing between them becomes painful.
- Don't add new dependencies without a clear reason — keep the stack lean, this is a solo project.
- Use installed shadcn/ui components for frontend UI elements wherever an appropriate component exists. Add components through the shadcn CLI when needed; use custom Tailwind markup only for layout or when shadcn has no suitable primitive.

## Commands (api)

- `bun run dev` — start dev server with watch mode
- `bun run db:seed` — populate DB with sample resources/tags for local testing
- `bun run db:generate` — generate a new migration from schema changes
- `bun run db:migrate` — apply pending migrations
- `docker compose up -d` — start Postgres + Redis
- `docker compose down -v` — full reset (wipes DB volume)

## Current status

CRUD and synchronous Gemini enrichment are working for `resources`, and resource responses include related tags. A minimal Next.js frontend supports creating and listing resource cards. Content extraction, embeddings/search, queues, and auth are not implemented yet. See `CONTEXT.md` for full history and next steps.
