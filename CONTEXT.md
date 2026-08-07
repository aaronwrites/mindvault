# MindVault — Project Context

## Vision

Developers accumulate huge amounts of technical information across articles, docs, GitHub repos, videos, PDFs, and notes. Traditional bookmark managers just store links and rely on manual folders/tags, so saved resources become hard to retrieve and often go unused.

MindVault is a developer-focused Personal Knowledge Management (PKM) platform that goes beyond storage: it captures resources from multiple sources, automatically enriches them with AI-generated summaries, tags, and embeddings, and makes them retrievable through natural-language and semantic search rather than manual organization. Philosophy: **capture once, understand automatically, recall effortlessly.**

Being built solo, as both a portfolio piece and a university project proposal — so the technical approach is deliberately also a showcase of full-stack development, cloud-native architecture, and DevOps practices, sequenced so a working product exists well before the more advanced infrastructure work.

## Key decisions made so far (chronological)

1. **Architecture approach**: start as a **modular monolith** rather than full microservices from day one. Internal module boundaries (`resources`, `search`, `ai`, `auth`) are kept clean specifically so pieces can be extracted into real services later without a rewrite. Full microservices/Kubernetes is a later "cloud-native showcase" phase, not the starting point.

2. **Backend framework**: considered NestJS (natural fit for the monolith-to-microservices path via its module/DI system) but **decided on Express** instead, since it's the framework already known best. Tradeoff accepted: module boundaries and DI must be enforced manually through folder conventions rather than framework-provided structure.

3. **Runtime**: **Bun** — faster installs/startup, native TypeScript support. Compatibility with native npm modules (BullMQ's `ioredis` dependency, Cloudinary SDK) was checked and is not expected to be an issue since those are pure JS/TS.

4. **Database**: **PostgreSQL with the pgvector extension**, not a NoSQL database. This was debated explicitly — the "NoSQL is better for unstructured AI data" argument doesn't hold up well here because MindVault's core problems (relationships between resources for a knowledge graph, vector similarity search) are exactly what Postgres+pgvector handles natively, while flexible per-type metadata is handled fine with a `JSONB` column. Object files (PDFs, screenshots) never live in the database — only metadata, tags, relationships, and embeddings do.
   - Currently running **PostgreSQL 18** (`pgvector/pgvector:pg18` Docker image) — upgraded from an initial default of 16 after confirming pgvector supports it.

5. **ORM**: chose **Drizzle over Prisma**, mainly because Drizzle handles pgvector similarity queries (`ORDER BY embedding <=> $1`) as native, type-safe queries, whereas Prisma pushes that into an untyped `$queryRaw` escape hatch. Secondary benefit: no generated client/binary, lighter Docker images.

6. **Object storage**: **Cloudinary**, not S3. Cloudinary's free tier (25GB storage + bandwidth/month, no time limit) is more generous than S3's free tier (5GB, 12 months only), and it handles image transformation/thumbnailing automatically — a direct win for the screenshot resource type.

7. **AI approach**: originally scoped around paid APIs (Anthropic/OpenAI), but since usage is currently testing-only, pivoted to **free-tier providers** — specifically **Google Gemini (Flash model) via Google AI Studio**, which offers a large free daily request quota and a large context window, well suited to summarizing long saved articles/documents. Paid provider API keys remain an option later behind the same abstraction if a specific model's quality is needed for the final demo. Self-hosting open-source models was considered; embeddings are cheap to self-host if ever needed, but generative summarization needs GPU compute that isn't worth the cost at personal/portfolio scale — the free-tier API path was judged better for now.

8. **Frontend**: **Next.js** with **shadcn/ui**, kept at shadcn's defaults intentionally until the backend and core architecture are fully sorted — avoids spending time on visual polish before the product works.

9. **Repo structure**: **no monorepo tooling**. Plain `server/` and `client/` folders in a single repo, each with their own `package.json`. Real monorepo tooling (pnpm workspaces, Turborepo) deferred until there's an actual need, such as sharing TypeScript types between frontend and backend, or splitting the backend into multiple services.

10. **Content extraction strategy** (planned, not yet built): resource type is detected from the URL (GitHub, YouTube, PDF, generic article) and routed to a type-specific extractor:
    - Generic articles: fast path first — plain `fetch()` + Open Graph Scraper (metadata) + Mozilla Readability (clean article text). Falls back to **Playwright** (or a hosted headless-browser API) only when the fast path returns suspiciously little content — signals a client-side-rendered page. Playwright is deliberately the exception, not the default, due to memory/cost concerns on a free-tier host.
    - GitHub repos: GitHub REST API, not HTML scraping.
    - YouTube: oEmbed/Data API for metadata, transcript libraries for actual content to summarize.
    - PDFs: `pdf-parse` after the file is stored in Cloudinary; scanned/image PDFs would need OCR later (not yet planned in detail).

11. **Future scope**: a **browser extension** is planned, but explicitly sequenced to start only after the core web app is complete. It will be a thin client against the existing API (paste/save from any page), which is why token-based auth (rather than cookie/session-only) is being kept in mind for the API design.

## Build order / roadmap

The agreed approach is to build the thinnest possible end-to-end slice first, then layer in complexity one piece at a time so failures are easy to isolate:

1. **Scaffold the repo** — `server/` + `client/` folders, Docker Compose for Postgres+pgvector and Redis. ✅ Done.
2. **Stand up the database** — pgvector-enabled Postgres running, initial Drizzle schema (`resources`, `tags`, `resource_tags`), first migration applied. ✅ Done.
3. **Build a bare CRUD API** — `POST /resources`, `GET /resources`, `GET /resources/:id`, no AI yet. ✅ Done, including a controller/route split (routes only map paths to controllers; controllers hold the logic) and a seed script for consistent test data.
4. **Wire up one AI call, synchronously** — call the Gemini free-tier API directly and inline on resource creation to get a summary + tags back. **Not started.**
5. **Build the minimal frontend** — a paste-a-URL form plus a list of resource cards (title, summary, tags), no auth or styling polish yet. **Not started.**
6. **Add embeddings and semantic search** — an `embeddings` table, generate a vector per resource, build a `pgvector`-powered search endpoint. **Not started.**
7. **Move AI processing to a background job** — introduce BullMQ + Redis + a separate worker process; swap the synchronous AI call for a queued job; add Cloudinary for actual file uploads (PDFs, screenshots) at this stage. **Not started.**
8. **Layer in the rest** — relations table for the knowledge graph, tags UI, auth, proper Dockerization, CI/CD via GitHub Actions. The AWS/Terraform "cloud-native showcase" phase (ECS/k3s, monitoring, IaC) is saved for the very end, once the product itself works. **Not started.**

## Current status (as of last session)

Steps 1–3 above are complete and verified working locally: Docker Compose brings up Postgres 18 (with pgvector) and Redis, the Express server responds on a health check, the `resources`/`tags`/`resource_tags` schema is migrated, CRUD endpoints work end-to-end, controllers are separated from routes, and a seed script populates realistic test data.

**Next step**: Step 4 — wire up a synchronous Gemini API call on resource creation to get a real summary + tags back, before adding any queue/worker complexity.