# MindVault API

The API durably Captures public HTTP(S) Sources as Knowledge Items. A separate worker processes eligible Processing Attempt stages to extract Source Snapshots, create and index Passages, and generate Recognition Summaries and Topic Tags.

## Run

```bash
bun run db:migrate
bun run dev
```

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

## Original File storage

Original Files use the `cloudinary` SDK only inside `src/lib/original-files/cloudinary-original-file-storage.ts`. It is the server-only adapter for authenticated retention, short-lived signed access, and idempotent deletion; the rest of the application depends only on the provider-neutral storage boundary.

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` only in the API environment when file storage is enabled. Their absence does not prevent the URL-only API from starting.
