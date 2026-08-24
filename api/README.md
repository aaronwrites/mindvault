# api

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Tests

```bash
TEST_DATABASE_URL=postgres://user:password@localhost:5432/postgres bun test
```

The integration harness creates a uniquely named database from this connection,
applies the checked-in forward migrations, and drops it after each test. Never
point `TEST_DATABASE_URL` at a database containing development data.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
