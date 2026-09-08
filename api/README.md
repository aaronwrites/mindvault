# MindVault API

The API durably Captures public HTTP(S) Sources as Knowledge Items. A separate worker processes eligible Processing Attempt stages to extract Source Snapshots, create and index Passages, and generate Recognition Summaries and Topic Tags.

## Run

```bash
ollama pull gemma3:latest
ollama pull nomic-embed-text:latest
bun run db:migrate
bun run dev
```

MindVault uses the local Ollama server at `http://127.0.0.1:11434`. Override it
with `OLLAMA_BASE_URL`; override the installed tags with
`OLLAMA_GENERATION_MODEL` and `OLLAMA_EMBEDDING_MODEL`. Startup preflights both
models and fails with a configuration error when Ollama is unavailable or a tag
is missing. There is no cloud fallback.

Generation uses a 32,768-token context, temperature 0.2, and a 2,048-token
output limit. MindVault rejects generation inputs above 28,000 UTF-8 bytes so it
never silently drops evidence or grounding instructions. Embedding requests also
disable Ollama's automatic truncation.

`bun run dev` starts both the API and its local Processing worker, so new Captures
will leave Processing automatically. In a deployed or separately managed setup,
start the worker independently with `bun run worker`.

Development seeding creates sample Captures in the Processing state. Run the worker to process them:

```bash
bun run db:seed
```

When starting PostgreSQL from the repository root, `docker compose up -d` loads
the `POSTGRES_*` values from `api/.env`.

## Tests

```bash
TEST_DATABASE_URL=postgres://user:password@localhost:5432/postgres bun test
```

The integration harness creates a uniquely named database from this connection,
applies the checked-in forward migrations, and drops it after each test. Never
point `TEST_DATABASE_URL` at a database containing development data.

## Migrating existing embeddings

Stop the API and every worker before migration. Back up the database first:

```bash
pg_dump --format=custom --file=mindvault-before-ollama.dump "$DATABASE_URL"
bun run ai:reembed
```

`ai:reembed` preflights both Ollama models, then scans every retained Passage in
ID order, including historical snapshots and Trashed Knowledge Items. It replaces
only missing or incompatible embeddings and commits each successful Passage
independently. Re-running the command skips compatible rows, so an interrupted
run resumes safely. It reports processed, skipped, failed, and remaining counts
and exits unsuccessfully while any incompatible rows remain. It does not refetch
Sources or regenerate summaries, tags, Capture Context, or Original Files.

## Original File storage

Original Files use the `cloudinary` SDK only inside `src/lib/original-files/cloudinary-original-file-storage.ts`. It is the server-only adapter for authenticated retention, short-lived signed access, and idempotent deletion; the rest of the application depends only on the provider-neutral storage boundary.

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` only in the API environment when file storage is enabled. Their absence does not prevent the URL-only API from starting.

The API key must be permitted to use Cloudinary's Upload API. A successful Admin API ping alone is not sufficient: Cloudinary returns HTTP 403 for an API key or product environment that is not allowed to upload. Create or update a server-side API key with Upload API access in the Cloudinary Console, replace the key and secret in `api/.env`, then restart the API process. Do not use an unsigned upload preset or expose the API secret to Next.js.

For a Cloudinary product environment hosted in the EU or AP data center, also set `CLOUDINARY_UPLOAD_PREFIX` to its API endpoint (for example, `https://api-eu.cloudinary.com`).
