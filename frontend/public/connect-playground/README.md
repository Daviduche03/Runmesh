# Connect Playground

Manual end-to-end harness for Runmesh Connect. Simulates two third-party apps (**TaskFlow** and **NotePad**) that share portable identity for the same human.

## URL

With the frontend dev server running:

```
http://localhost:5173/connect-playground/
```

## Prerequisites

1. Runmesh API on `http://localhost:8787` (wrangler dev).
2. Frontend on `http://localhost:5173` (`pnpm dev` in `frontend/`).
3. Google Connect OAuth env vars configured on the worker.
4. Developer JWT — log into the dashboard on the same origin (uses `runmesh-token` in localStorage) or paste a JWT on the playground page.

## Quick start

1. Open the playground URL.
2. Click **Use dashboard token** (after logging into `/dashboard`).
3. Click **Create demo apps** — registers two Connect apps with callback URLs:
   - `http://localhost:5173/connect-playground/callback-a.html`
   - `http://localhost:5173/connect-playground/callback-b.html`
4. Follow the in-page checklist.

## Test matrix

| Step | App A | App B | Expected |
|------|-------|-------|----------|
| Authenticate | Same email + OTP | Same email + OTP | Same `connect_user_id` |
| Connect | Google OAuth | — | Connection stored |
| Grant | — | Grant scopes | Consent (reuses connection) |
| Grants | List grants | List grants | Each app has its own grant |

## OTP in local dev

Without `RESEND_API_KEY`, OTP codes are printed in wrangler logs:

```
[connect-otp] ...
```

## API script

For automated smoke tests, use `runmesh-main/scripts/e2e_connect.sh` alongside this playground.

## Note

Connect API calls use the **developer JWT** today. Production third-party apps will need app-scoped credentials later; this playground is for local integration testing only.
