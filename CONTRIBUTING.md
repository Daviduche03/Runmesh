# Contributing to Runmesh

Thank you for your interest in contributing.

## Getting started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Set up the backend and frontend using the [README](./README.md)
4. Create a branch for your change

```bash
git checkout -b feat/your-feature-name
```

## Development workflow

- Backend changes live in `runmesh-ts/` (Bun + Express + Drizzle); the retired
  FastAPI server in `legacy/runmesh-main/` is a read-only parity reference
- Frontend changes live in `frontend/`
- Keep the HTTP contract stable: response envelope, snake_case wire fields, and
  the SQLite schema. Schema changes are new numbered migrations in
  `runmesh-ts/migrations/` plus `schema.sql`
- Do not commit secrets, `.env` files, or local Cloudflare resource IDs

## Pull requests

1. Describe what changed and why
2. Include a test plan (commands run, screenshots for UI changes)
3. Keep commits focused and messages clear
4. Open the PR against the `main` branch

## Code style

- Backend: `pnpm typecheck && pnpm test` in `runmesh-ts/`; migrations must stay
  append-only and mirrored in `schema.sql`
- Frontend: run `pnpm lint` and `pnpm format` in `frontend/` before submitting

## Questions

Open a GitHub issue for bugs, feature requests, or setup problems.
