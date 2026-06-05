# Runmesh Dashboard

React + Vite frontend for the Runmesh task execution platform.

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server at `http://localhost:5173` |
| `pnpm build` | Production build |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Format with Prettier |

## Environment

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend Worker URL (default `http://localhost:8787`) |

See the [root README](../README.md) for full project documentation.
