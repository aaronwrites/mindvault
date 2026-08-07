# MindVault — Tasks

Checklist for delegating build work to agents. Organized by build-order step (see `context.md` for rationale). Check items off as agents complete them. Each step should be finished and verified before the next one starts.

---

## Step 1 — Scaffold the repo ✅ DONE

- [x] Create `server/` and `client/` folders in one repo
- [x] Initialize `server/` with Bun (`bun init`)
- [x] Add `docker-compose.yml` with `pgvector/pgvector:pg18` and `redis:7-alpine`
- [x] Confirm `docker compose up -d` brings up both containers cleanly
- [x] Add `.env.example` / `.env` for `DATABASE_URL`, `PORT`

## Step 2 — Stand up the database ✅ DONE

- [x] Enable pgvector extension (comes pre-installed in the chosen image)
- [x] Write initial Drizzle schema: `resources`, `tags`, `resource_tags`
- [x] Configure `drizzle.config.ts`
- [x] Run first migration (`drizzle-kit generate` + `migrate`)
- [x] Confirm tables exist in the running Postgres container

## Step 3 — Build a bare CRUD API ✅ DONE

- [x] DB client singleton (`db/index.ts`)
- [x] Zod schema for resource creation (`schemas/resource.ts`)
- [x] `POST /resources` — create a resource
- [x] `GET /resources` — list resources
- [x] `GET /resources/:id` — fetch one resource
- [x] Split routes and controllers (`controllers/resources.controller.ts`, `routes/resources.ts`)
- [x] Add dev seed script (`db/seed.ts`, `bun run seed`) with sample resources/tags
- [x] Verify endpoints manually via curl

## Step 4 — Wire up one AI call, synchronously ⬜ NOT STARTED

- [ ] Get a Gemini API key from Google AI Studio, add to `.env`
- [ ] Write a minimal Gemini client wrapper (`lib/ai/gemini.ts`) — takes text, returns structured JSON (summary, tags, technologies, content_type, difficulty)
- [ ] Define a Zod schema to validate the LLM's JSON response before trusting it
- [ ] Call the AI wrapper synchronously inside `createResource` controller, using `title`/`url` as input for now (no real content extraction yet)
- [ ] Store `summary` and `tags` back onto the resource on creation
- [ ] Handle failure gracefully (LLM error, malformed JSON) without crashing the request
- [ ] Manually test: create a resource via curl, confirm summary + tags come back populated

## Step 5 — Build the minimal frontend ⬜ NOT STARTED

- [ ] Scaffold Next.js app in `client/`
- [ ] Install and configure shadcn/ui (defaults, no custom theming yet)
- [ ] Build a "paste a URL" form (title, url, sourceType)
- [ ] Build a `ResourceCard` component (title, summary, tags, link)
- [ ] Build a resource list page that fetches `GET /resources` and renders cards
- [ ] Wire the form to `POST /resources`
- [ ] Confirm full loop: paste a link → card appears with AI-generated summary/tags

## Step 6 — Add embeddings and semantic search ⬜ NOT STARTED

- [ ] Add `embeddings` table (Drizzle schema, linked to `resource_id`)
- [ ] Migrate the new table
- [ ] Write embedding generation call (Gemini or a small local embedding model)
- [ ] Generate and store an embedding synchronously on resource creation
- [ ] Build `GET /search?q=` endpoint: embed the query, run a pgvector `<=>` similarity query, return ranked results
- [ ] Add a search bar to the frontend, wire it to the search endpoint
- [ ] Manually test with a handful of seeded resources covering different topics

## Step 7 — Move AI processing to a background job ⬜ NOT STARTED

- [ ] Add BullMQ + Redis connection setup
- [ ] Create an `ingestion` queue and a worker process (separate entrypoint, e.g. `src/worker.ts`)
- [ ] Add `ingestion_jobs` table to track status (`pending` / `processing` / `complete` / `failed`) per resource
- [ ] Move the synchronous Gemini summarize/tag/embed calls from the controller into the worker
- [ ] `createResource` now just inserts the row and enqueues a job, returns immediately
- [ ] Frontend polls job status (or add a websocket/SSE push later) and updates the card once processing completes
- [ ] Add Cloudinary integration: file upload endpoint, store returned URL on the resource, used for PDFs/screenshots
- [ ] Build content extractors:
  - [ ] Generic article extractor (Open Graph Scraper + Readability, `fetch()`-based)
  - [ ] Playwright (or hosted headless-browser API) fallback for CSR pages, triggered only when the fast path returns too little content
  - [ ] GitHub repo extractor (GitHub REST API)
  - [ ] YouTube extractor (oEmbed/Data API + transcript)
  - [ ] PDF extractor (`pdf-parse` on the Cloudinary-stored file)
- [ ] Worker calls the right extractor based on detected source type before calling the AI

## Step 8 — Layer in the rest ⬜ NOT STARTED

- [ ] `relations` table (resource-to-resource links) for the knowledge graph
- [ ] Auto-populate relations from embedding similarity above a confidence threshold
- [ ] Tags UI: browse/filter by tag
- [ ] Auth (token-based, to support the future browser extension)
- [ ] Proper multi-stage Dockerfiles for `server/` and `client/`
- [ ] CI pipeline via GitHub Actions (lint, typecheck, build on push)
- [ ] AGENTS.md and context.md kept up to date as architecture evolves

## Later — Cloud-native showcase phase ⬜ NOT STARTED

- [ ] Terraform for AWS resources
- [ ] Deploy via ECS Fargate or a single-node k3s cluster (avoid full EKS — control plane cost)
- [ ] Basic monitoring/observability (Grafana Cloud free tier or CloudWatch)
- [ ] Record demo, then tear down cloud resources to control cost

## Later — Browser extension ⬜ NOT STARTED

- [ ] Scaffold extension project (after core web app is fully working)
- [ ] Extension hits the existing `POST /resources` endpoint using token auth
- [ ] Capture current page URL / selected text and send to API