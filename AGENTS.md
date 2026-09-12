# Server Agent Guide

Express 5 + Prisma 7 + PostgreSQL API. Read the root [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md) for cross-app architecture and product rules.

## Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm generate
pnpm migrate
pnpm verify:postman
```

Run a live-database verification script with `pnpm exec tsx scripts/<script>.ts`. The server intentionally has no unit-test runner; `pnpm test` exits with the package's placeholder failure.

## Required conventions

- Keep each domain under `src/app/module/<domain>/` with route, controller, service, validation, and interface files as appropriate. Controllers stay thin; business logic belongs in services.
- Return API responses through `sendResponse` using the envelope `{ success, message, data, meta? }`. Throw `AppError` for expected failures.
- Import the generated Prisma client from the relative path `../../generated/prisma/client`; do not import `@prisma/client` directly. Run `pnpm generate` after schema changes.
- Prisma schema files live under `prisma/schema/`, normally one model per file. Use migrations deliberately; do not treat `db push` as a substitute for a reviewed migration.
- Preserve route ordering in `src/app/routes/index.ts`: literal and nested paths must be mounted before parent `/:id` or `/:slug` routers.
- `checkAuth` requires both the better-auth session and JWT access-token cookies. Use `optionalAuth` only for intentionally guest-capable flows.
- `QueryBuilder` owns list search, filtering, sorting, relation-field handling, and pagination. Do not reimplement those concerns in controllers or clients.
- The Postman collection is the API contract. Update `postman/Ecom.postman_collection.json` with API changes and run `pnpm verify:postman`; keep the admin/frontend copies synchronized when the change affects their contract.
- Do not expose secrets or assume a database is available. Check `.env.example` and use a live database only for scripts that require one.

Before changing a subsystem, inspect its nearby module, an existing verification script, and the relevant OpenSpec design/spec under `openspec/`. Completed `openspec/changes/` entries are historical context, not current implementation truth.
