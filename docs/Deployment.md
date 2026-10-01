# 🚀 Transformlit Deployment

Date: 2026-06-25

## 🔭 Overview

Transformlit is deployed on **Azure Container Apps** with infrastructure managed by **Terraform** and CI/CD orchestrated by **GitHub Actions**. Container images are stored in **GitHub Container Registry (GHCR)**. DNS and SSL are handled by **Cloudflare**.

```
Developer pushes to main
         │
         ▼
┌─────────────────────────────────────────────┐
│  GitHub Actions                              │
│                                              │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐ │
│  │ infra.yml │  │deploy-api  │  │deploy-web│ │
│  │ Terraform │  │ build      │  │ build    │ │
│  │ plan/apply│  │ push GHCR  │  │ push GHCR│ │
│  └─────┬─────┘  │ deploy ACA │  │deploy ACA│ │
│        │        └─────┬──────┘  └────┬─────┘ │
└────────┼──────────────┼─────────────┼───────┘
         │              │             │
         ▼              ▼             ▼
┌─────────────────────────────────────────────┐
│  Azure                                       │
│                                              │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐ │
│  │ PostgreSQL  │  │ACA: api  │  │ACA: web  │ │
│  │ Blob Store  │  │(NestJS)  │  │(Next.js) │ │
│  │ Key Vault   │  │/api/*    │  │/*        │ │
│  │ ACS Email   │  └──────────┘  └──────────┘ │
│  └────────────┘        │             │       │
│                        └──────┬──────┘       │
│                               │              │
│                    Cloudflare ◄┘              │
│                    app.transformlit.com       │
└─────────────────────────────────────────────┘
```

## ☁️ Cloud Architecture

| Component | Azure Service | SKU / Tier | Cost/mo (est.) |
|---|---|---|---|
| API container | Container App | Consumption (min_replicas=1) | $10 |
| Web container | Container App | Consumption (min_replicas=0) | $0-2 |
| Database | PostgreSQL Flexible Server | Burstable B1ms (1 vCore, 2 GB) | $15 |
| File storage | Blob Storage (StorageV2) | LRS, Hot | $0.10 |
| Secrets | Key Vault | Standard | $0 (free tier) |
| Email | Communication Services | Pay-as-you-go | $0 (sponsorship credits) |
| Monitoring | App Insights + Log Analytics | Pay-as-you-go, 5 GB free | $0 |
| Container registry | GHCR (not Azure) | Free with GitHub | $0 |
| **Total** | | | **~$25-30/mo** |

All costs covered by Azure nonprofit sponsorship ($2,000/yr credits).

## 🌍 Environment Strategy

| Env | Domain | Terraform dir | Deploy trigger |
|---|---|---|---|
| `dev` | `dev.transformlit.com` | `infra/dev/` | merge PR to `main` |
| `prod` | `app.transformlit.com` | `infra/prod/` | tag `v*` on `main` |

Each environment has its own resource group, Container Apps environment, PostgreSQL instance, and DNS records. State files are stored in separate containers in the same Azure Storage account.

## 🏗️ Terraform Structure

```
infra/
├── backend.tf                           # Azure Storage backend config
├── providers.tf                         # azurerm provider
├── variables.tf                         # Input variables (global)
├── outputs.tf                           # Output values
├── modules/
│   ├── resource-group/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── postgresql/
│   │   ├── main.tf                      # Flexible Server + database + firewall + AD admin
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── blob-storage/
│   │   ├── main.tf                      # Storage account + containers (pdfs, uploads, covers, avatars)
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── container-apps-env/
│   │   ├── main.tf                      # ACA environment + Log Analytics workspace
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── container-app/
│   │   ├── main.tf                      # Reusable: api or web app + ingress + secrets refs
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── key-vault/
│   │   ├── main.tf                      # Vault + secrets + RBAC
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── communication-services/
│   │   ├── main.tf                      # ACS Email + domain verification
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── monitoring/
│       ├── main.tf                      # App Insights
│       ├── variables.tf
│       └── outputs.tf
├── dev/
│   ├── main.tf                          # Calls modules with dev params
│   ├── terraform.tfvars
│   └── outputs.tf
└── prod/
    ├── main.tf
    ├── terraform.tfvars
    └── outputs.tf
```

**Terraform backend** (Azure Storage, configured in `backend.tf`):

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "rg-terraform-state"
    storage_account_name = "tfsatransformlit"
    container_name       = "tfstate"
    key                  = "transformlit.tfstate"
  }
}
```

**Key variables per environment** (`terraform.tfvars`):

```hcl
# dev/terraform.tfvars
environment        = "dev"
location           = "southeastasia"
postgres_sku       = "B_Standard_B1ms"
postgres_storage   = 32
container_api_min  = 1
container_web_min  = 0
domain_name        = "dev.transformlit.com"
```

(~65 managed resources per env — well under HCP Terraform free 500 RUM limit.)

## 🔄 GitHub Actions Workflows

### infra.yml — Terraform Plan/Apply

```yaml
name: Infrastructure

on:
  pull_request:
    paths: ["infra/**"]
    branches: [main]
  push:
    paths: ["infra/**"]
    branches: [main]
    tags: ["v*"]

jobs:
  terraform:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write               # OIDC for az login

    steps:
      - uses: actions/checkout@v4

      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "~1.10"

      - name: Terraform Init
        run: terraform init -backend-config="key=transformlit-${{ env.ENV }}.tfstate"
        working-directory: infra/${{ env.ENV }}

      - name: Terraform Plan
        run: terraform plan -out=tfplan
        working-directory: infra/${{ env.ENV }}

      - name: Terraform Apply
        if: github.event_name == 'push'
        run: terraform apply -auto-approve tfplan
        working-directory: infra/${{ env.ENV }}
```

### deploy-api.yml — Build + Push + Deploy API

```yaml
name: Deploy API

on:
  push:
    paths: ["apps/api/**", "packages/shared/**", "packages/graphql/**"]
    branches: [main]
    tags: ["v*"]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write              # push to GHCR
      id-token: write              # OIDC

    steps:
      - uses: actions/checkout@v4

      - name: Docker build & push
        run: |
          echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
          docker build -f apps/api/Dockerfile -t ghcr.io/${{ github.repository_owner }}/transformlit-api:${{ github.sha }} .
          docker push ghcr.io/${{ github.repository_owner }}/transformlit-api:${{ github.sha }}

      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy to Container Apps
        uses: azure/container-apps-deploy-action@v2
        with:
          imageToDeploy: ghcr.io/${{ github.repository_owner }}/transformlit-api:${{ github.sha }}
          containerAppName: transformlit-api-${{ env.ENV }}
          resourceGroup: rg-transformlit-${{ env.ENV }}
```

### deploy-web.yml — Build + Push + Deploy Web

```yaml
# Same structure as deploy-api.yml, targets transformlit-web-${{ env.ENV }}
# Trigger: apps/web/**, packages/shared/**, packages/graphql/**
```

## 🌐 Domain Setup (Cloudflare)

### DNS Records (per environment)

| Env | Type | Name | Value |
|---|---|---|---|
| Dev | A | `dev.transformlit.com` | ACA environment ingress IP |
| Dev | TXT | `asuid.dev.transformlit.com` | ACA domain verification token |
| Prod | A | `app.transformlit.com` | ACA environment ingress IP |
| Prod | TXT | `asuid.app.transformlit.com` | ACA domain verification token |

After DNS propagates, the Container App ingress binding auto-provisions a managed TLS certificate. Cloudflare SSL mode: **Full (strict)**.

### ACS Email Domain Verification (Terraform)

Terraform creates the Azure Communication Services Email domain. Once provisioned, the module outputs the DNS verification tokens. Add these to Cloudflare:

| Type | Name | Value |
|---|---|---|
| TXT | `@` | `azurecomm-verification=...` (SPF) |
| CNAME | `selector1._domainkey` | DKIM CNAME |
| CNAME | `selector2._domainkey` | DKIM CNAME |

Manual step until automated via Cloudflare Terraform provider.

## 🗄️ Prisma Migrations in CI/CD

Migrations run automatically before deploy:

```yaml
- name: Run Prisma migrations
  run: |
    npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

This requires the DB to be network-reachable from the GitHub Actions runner. Approach:
- **Option A** (dev only): Allow GH Actions runner IP in PostgreSQL firewall. Rotate IP allowlist.
- **Option B** (recommended): Use Azure Service Connector or a jump VM with a stable outbound IP.

## 🔁 CI/CD Flow

1. Developer opens a PR with Terraform changes
2. `infra.yml` runs `terraform plan` → plan output posted as PR comment
3. PR merged to `main` → `infra.yml` auto-applies `dev` environment
4. Code PR merged to `main` → `deploy-api.yml` builds, pushes to GHCR, deploys to `dev` ACA
5. Smoke tests run against `dev.transformlit.com`
6. Tag `v1.0.0` pushed → `infra.yml` applies `prod` + `deploy-api.yml` deploys to `prod`
7. ACA revision labeled `prod` activated

## ✋ Manual Actions

### Destroy environment
```bash
cd infra/dev
terraform destroy -auto-approve
```

### View Container App logs
```bash
az containerapp logs show -n transformlit-api-dev -g rg-transformlit-dev --follow
```

### Rollback to previous revision
```bash
az containerapp revision activate \
  -n transformlit-api-prod \
  -g rg-transformlit-prod \
  --revision transformlit-api-prod--<hash>
```

## 📴 PWA offline delivery path and release gates (Task 14C)

Date: 2026-10-02. This section records the **actual** offline delivery path, the evidence
that exists on this branch, and the external evidence that must be supplied before a PWA
release. It deliberately does **not** substitute local-container evidence for production
infrastructure or physical-device evidence.

**Status: RELEASE BLOCKED.** The repository-controlled code and CI gates are complete and
review-clean, but the live-origin, CDN-retention, translation-rights and real-iOS-device
evidence below is unverified. Do not enable translation downloads, private offline
downloads or installed-PWA offline edits until the blocking items are closed.

### Delivery path ownership (from repository evidence)

The repository does not provision or configure a CDN, Workers, Cache Rules or Page Rules.
The only delivery topology that repository Terraform actually defines is:

| Layer | What the repo provisions | Owner |
| --- | --- | --- |
| DNS + TLS termination | Nothing in `infra/`; `docs/ARCHITECTURE.md` / `docs/MEMORY.md` document Cloudflare "DNS + Full SSL" and `docs/Deployment.md` documents Full (strict) | Cloudflare account (external) |
| Reverse proxy / edge cache | Nothing in `infra/`; no `cloudflare_*` resources, no cache/worker module | Cloudflare account (external) |
| HTTPS ingress | `azurerm_container_app` ingress (`external_enabled = true`, `transport = "auto"`, `allow_insecure_connections = false`) | Terraform (`infra/modules/container-app/main.tf`) |
| TLS certificate | ACA managed certificate auto-provisioned on custom-domain binding | ACA / Terraform custom-domain binding |

**Important distinction (unresolved):** `docs/Deployment.md`, `docs/ARCHITECTURE.md` and
`docs/MEMORY.md` document a **path-split** proxy (`/api/*` → API container, `/*` → web
container) and `wss://{domain}/api/graphql`. The actual server environment variables in
both `infra/dev/main.tf` and `infra/prod/main.tf` are **not** path-split — the web build
receives `NEXT_PUBLIC_API_URL=https://{domain}/graphql` and
`NEXT_PUBLIC_WS_URL=wss://{domain}/graphql` (no `/api` prefix), while the API container's
`NEXT_PUBLIC_API_URL` is also `https://{domain}/graphql`. The real owner of `/graphql`,
`/api/*`, `/api/graphql` and the WebSocket upgrade path through the Cloudflare/ACA edge
**has not been verified** and is an external evidence item (E1 below).

### What is verified on this branch (code + local harness)

The following are verified and reproducible in this repository. They are **local-harness
evidence only** and do not prove the real origin.

- **Worker/MIME/cache/scope headers from the built image.** `docker build -f
  apps/web/Dockerfile` (14A, image `transformlit-web@sha256:bbd588d4303a…`) served on
  `localhost:3100`:
  - `GET /sw.js` → `200`, `Content-Type: application/javascript; charset=utf-8`,
    `Cache-Control: no-cache, no-store, must-revalidate`, `Service-Worker-Allowed: /`.
  - `GET /pwa-assets.json` → `200`, `application/json; charset=utf-8`,
    `Cache-Control: no-cache, no-store, must-revalidate`.
  - `GET /manifest.webmanifest` → `200`, `content-type: application/manifest+json`,
    `cache-control: public, max-age=0, must-revalidate`; body has `start_url: /offline`,
    `scope: /`, `display: standalone`, maskable icon present.
  - `GET /offline` → `200`; effective CSP contains `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'`, `worker-src 'self'`.
  - Hashed `/_next/static/chunks/<hash>.js` → `200`, `Cache-Control: public,
    max-age=31536000, immutable`; a missing hashed chunk → `404`.
  - Static `public/` assets (icons) → `200` with correct MIME.
- **Generated artifacts agree.** `apps/web/scripts/build-pwa-assets.mjs --verify` matches
  `.next/BUILD_ID`; `sw.js` embeds the same release id/inventory digest as
  `pwa-assets.json`; mixed-release install is rejected and consent-gated activation is
  unit-covered (14A).
- **CI gates** (14B, `.github/workflows/opencode-review.yml`) run real type/contract/unit/
  build/integration checks; the AI `review` job is not a correctness gate. `pwa-chromium`
  is wired as a blocking job but has not run green (see N4).
- **Licensing gate fails closed.** `docs/superpowers/specs/2026-10-01-bible-offline-rights.md`
  records that no per-translation license grants offline storage/redistribution/format
  conversion; all curated translations are disabled until a reviewed record is supplied.

### Blocking external evidence (must be supplied by the named owner)

Each item below is **UNVERIFIED** on this branch. Supply the exact artifact in the
Evidence column; do not mark complete without it.

| # | Item | Required evidence | Supplier |
| --- | --- | --- | --- |
| E1 | Real edge path ownership for `/`, `/sw.js`, `/api/*`, `/graphql`, `/api/graphql`, WS upgrade, and `/_next/static/**` | Account-side screenshot/export of the proxy/CDN config naming which resource handles each path; reconcile the documented `/api/*` split with the actual `/graphql` env URLs | Cloudflare/edge owner (delivery-path owner) |
| E2 | `/sw.js` + `/pwa-assets.json` cache bypass (never `HIT`) | `curl -sSI https://<origin>/sw.js` showing `cf-cache-status: BYPASS`/`DYNAMIC` and correct `content-type`/`cache-control`/`service-worker-allowed`; repeat for `/pwa-assets.json` | Cloudflare/edge owner |
| E3 | Old hashed-asset retention (see retention rule) | After a real A→B deploy, an **old** `/_next/static/**` chunk referenced by release A still returns `200` (ideally `cf-cache-status: HIT`) through the production origin | Cloudflare/edge owner + release operator |
| E4 | No Worker/Snippet/Page Rule/Rocket Loader/HTML rewrite intercepting `/sw.js`, `/offline` or `/_next/static/**` | Account config export or reviewer attestation | Cloudflare/edge owner |
| E5 | ACA revision mode/traffic weights/`maxInactiveRevisions` and rollout overlap | `az containerapp revision list`/`show` output for the deployed web app; confirm single vs multiple revision behavior and the supported overlap window | Release operator |
| E6 | Trusted HTTPS on the real supported origin | Valid, non-expired public cert for `<origin>` from a trusted CA; `full (strict)` verified; setup must not install/derive custom CA roots into user/OS trust stores or downgrade TLS | Cloudflare/edge owner + release operator |
| E7 | Real iOS Safari + installed-PWA behavior | On a physical iOS device against the production origin: install, cold offline relaunch, storage/quota/persistent-storage request, worker update + consent, multi-tab, account lifecycle (same-account reauth, sign-out/discard, deferred logout) | QA/device owner |
| E8 | Per-translation offline rights | Reviewed license record per translation covering offline storage, redistribution and format conversion, added to `apps/web/src/lib/bible/offline-rights.ts` + `2026-10-01-bible-offline-rights.md` | Content/licensing owner |
| E9 | Live accessibility / reduced-motion / theme sign-off | Device/browser evidence for keyboard/focus/status announcements, colour contrast, light/dark themes and `prefers-reduced-motion` on the deployed origin | QA/accessibility owner |
| E10 | Branch protection actually requires the 14B `gate` | Repo settings screenshot/config showing `gate` (and required checks) block merges to `main`; `gh pr checks` green including `pwa-chromium` | Repository admin |
| E11 | PR opened from pushed branch | The branch is **not pushed** (`git ls-remote --heads origin` shows no `feature/pwa-offline`); push + `gh pr create` against `main` with the deployment/evidence summary | Release operator |

### Old-hashed-asset retention rule (BLOCKING — cross-ref Task 14A)

The repository cannot itself guarantee retention. The web app is served by the Next
standalone container behind ACA, and `infra/modules/container-app/main.tf` sets
`revision_mode = "Single"`, which **deprovisions old revisions**; there is no CDN/static
module in `infra/`. Therefore a lazy `/_next/static/**` chunk an open tab or installed PWA
never fetched can disappear after release B, white-screening that client.

Required rule (must be supplied/verified before release; this repo intentionally contains
**no guessed CDN config**):

- Retain prior-release hashed assets at the **CDN/edge** or an immutable static origin
  (`assetPrefix` + object storage), not via ACA revision pinning.
- Deploys must **never "Purge Everything"** and must not purge hashed `/_next/static/**`
  paths; purge only changed non-hashed URLs.
- Overlap window ≥ the supported client window (current deployed client + immediately
  previous still-open client).

No Terraform change is warranted until E3/E5 supply verified evidence of the actual
retention mechanism; modifying `infra/*` on speculation is out of scope.

### Local harness commands (reproducible; not origin evidence)

```bash
export DOCKER_HOST="unix:///Users/daryllmagsombol/.colima/default/docker.sock"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE="/var/run/docker.sock"
docker run -d --name tl-web -p 3100:3000 -e PORT=3000 transformlit-web:pwa
curl -sSI http://localhost:3100/sw.js
curl -sSI http://localhost:3100/pwa-assets.json
curl -sSI http://localhost:3100/manifest.webmanifest
curl -sSI http://localhost:3100/offline | grep -i content-security-policy
docker rm -f tl-web
```

Real-browser production E2E and the owned HTTPS harness remain **BLOCKED** (harness
supervisor is reaped; see 14A report). Playwright WebKit is supplemental and is **not**
proof of the iOS device requirements.
