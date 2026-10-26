# MindVault

Source-agnostic personal knowledge management system. MindVault durably captures Knowledge Items, organizes them automatically, and makes them retrievable from vague conceptual memory without requiring manual folders or taxonomy maintenance.

Built solo — as both a portfolio piece and a university project proposal.

## Stack

- **Runtime**: Bun
- **Backend**: Express + TypeScript
- **ORM**: Drizzle (raw SQL access for pgvector queries, no generated client)
- **Database**: PostgreSQL 18 (`pgvector/pgvector:pg18` Docker image), pgvector extension for embeddings
- **Background work**: PostgreSQL-backed Processing Attempt queue with a separate worker
- **Object storage**: Cloudinary authenticated assets behind a provider-neutral Original File storage boundary
- **AI**: Local Ollama using Gemma 3 for generation and Nomic Embed Text for embeddings
- **Frontend**: Next.js + shadcn/ui (kept at defaults for now — visual polish deferred until backend is solid)
- **Validation**: Zod
- **Next**: Complete PDF OCR, page-grounded Recall and Synthesis, and PDF quality acceptance, then broaden Source adapters before a thin browser capture client

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
  docker-compose.yml     PostgreSQL with pgvector
  AGENTS.md
  context.md
```

## Conventions

- Routes contain **no logic** — they only wire `path -> controller function`.
- Controllers hold request/response handling and call into `db` directly for now (no separate service/repository layer yet — add one only if controllers start getting complex).
- Keep hybrid retrieval in PostgreSQL using pgvector plus PostgreSQL text search; do not add a separate search service without a demonstrated need.
- No monorepo tooling (no Turborepo/Nx/pnpm workspaces). `api/` and `client/` are plain sibling folders, each with their own `package.json`. Revisit only if type-sharing between them becomes painful.
- Don't add new dependencies without a clear reason — keep the stack lean, this is a solo project.
- Use installed shadcn/ui components for frontend UI elements wherever an appropriate component exists. Add components through the shadcn CLI when needed; use custom Tailwind markup only for layout or when shadcn has no suitable primitive.

## Commands (api)

- `bun run dev` — start dev server with watch mode
- `bun run db:seed` — create sample Captures for local processing
- `bun run db:generate` — generate a new migration from schema changes
- `bun run db:migrate` — apply pending migrations
- `docker compose up -d` — start PostgreSQL
- `docker compose down -v` — full reset (wipes DB volume)

## Current status

MindVault durably captures and processes public textual webpages and retained selectable-text PDFs into recognizable Preview Cards, Source Snapshots, indexed Passages, Recognition Summaries, and Topic Tags. PDF evidence preserves physical page provenance and native Extraction gaps; OCR and complete PDF citation/Synthesis support remain pending. Original File capture, access, and lifecycle operations are implemented; other file understanding remains deferred. Knowledge Item availability is Processing, Ready, Unsupported, or Needs attention; Organization incomplete is a secondary condition. The next authoritative milestone is `.scratch/pdf-understanding/spec.md`: complete OCR, page-grounded Recall and Synthesis, and quality acceptance before broadening adapters. URL-to-chat closeout is verified. `context.md` is the domain glossary and `docs/adr/` records accepted architectural decisions.

## Agent skills

### Issue tracker

Issues and specs are tracked as local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default Matt Pocock skill labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain-doc layout. See `docs/agents/domain.md`.
