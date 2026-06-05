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

- Backend changes live in `runmesh-main/`
- Frontend changes live in `frontend/`
- Keep API changes backward-compatible within `/api/v1`, or document breaking changes in `runmesh-main/TASK_API_DOCUMENTATION.md`
- Do not commit secrets, `.env` files, or local Cloudflare resource IDs

## Pull requests

1. Describe what changed and why
2. Include a test plan (commands run, screenshots for UI changes)
3. Keep commits focused and messages clear
4. Open the PR against the `main` branch

## Code style

- Backend: follow existing Python patterns in `runmesh-main/src/`
- Frontend: run `pnpm lint` and `pnpm format` in `frontend/` before submitting

## Questions

Open a GitHub issue for bugs, feature requests, or setup problems.
