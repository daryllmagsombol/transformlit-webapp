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
