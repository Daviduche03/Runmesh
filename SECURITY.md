# Security Policy

## Supported versions

Security fixes are applied to the latest version on the `main` branch.

## Reporting a vulnerability

If you discover a security issue, please report it responsibly.

**Do not** open a public GitHub issue for security vulnerabilities.

Instead, email the maintainer or open a private security advisory on GitHub:

1. Go to [Security Advisories](https://github.com/Daviduche03/Runmesh/security/advisories)
2. Click **Report a vulnerability**
3. Describe the issue, impact, and steps to reproduce

You can expect an initial response within 7 days.

## Scope

Reports are in scope when they affect:

- Authentication or authorization bypass
- Exposure of secrets, tokens, or user data
- Remote code execution or injection in the API or dashboard
- Webhook delivery or task execution integrity issues

Out of scope: denial-of-service against your own Cloudflare account, issues in third-party dependencies without a practical exploit in Runmesh, or misconfiguration of your own deployment.

## Best practices for deployments

- Rotate `JWT_SECRET`, GitHub OAuth credentials, and API keys regularly
- Use Wrangler secrets for production values instead of committing them to `wrangler.jsonc`
- Restrict GitHub OAuth callback URLs to your real frontend and Worker URLs
