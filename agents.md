# MindVault

## Stack
- Runtime: Bun
- Backend: Express + TypeScript
- ORM: Drizzle (Postgres + pgvector)
- Queue: BullMQ + Redis
- Storage: Cloudinary
- AI: Gemini API (free tier) via Google AI Studio
- Frontend: Next.js + shadcn/ui

## Structure
- /server — Express API
- /client — Next.js frontend

## Commands
- `bun run dev` (in /server) — start dev server
- `bunx drizzle-kit generate` / `migrate` — schema migrations