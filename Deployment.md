# Deployment Plan

Target: this app runs on the shared Azure VM with Docker Compose, PostgreSQL in Docker, nginx in front, and Cloudflare already handling DNS.

## What Runs Where

- `apps/api`: NestJS API.
- `apps/web`: Next.js frontend.
- PostgreSQL: shared VM container, same origin stack.
- nginx: reverse proxy in front of the app and API.

## Implementation Plan

1. Build production images for API and web.
2. Keep API origin, CORS, and callback URLs env-driven.
3. Bind API on `0.0.0.0` for container access.
4. Use the shared VM Postgres service.
5. Proxy app traffic through nginx.
6. Support HTTPS origin for Cloudflare Full (strict).
7. Validate auth, migrations, and page load.

## VM Runbook

1. Clone this repo on the Azure VM.
2. Clone it under same parent folder as `blink-social-media`.
3. Copy runtime env values from the shared deployment env file.
4. Build and start containers.
5. Run Prisma migrations before exposing API traffic.
6. Verify `transformlit.darjosh.dev` and `/api` routes.
7. Check logs and restart only failed services.

## GitHub Trigger

- On `push` to `main`, GitHub Actions can SSH into the VM and rebuild transformlit services.
- Add `workflow_dispatch` for manual deploy.
- Use repo secrets for `AZURE_VM_HOST`, `AZURE_VM_USER`, `AZURE_VM_SSH_KEY`, and `DEPLOY_ROOT`.
- `DEPLOY_ROOT` should match the VM path that contains both repos, for example `/opt/apps`.

## Current Files

- [apps/api/src/main.ts](apps/api/src/main.ts)
- [apps/api/Dockerfile](apps/api/Dockerfile)
- [apps/web/Dockerfile](apps/web/Dockerfile)

## Notes

- Cloudflare already handles DNS.
- The frontend should call `https://transformlit.darjosh.dev/api` in production.
