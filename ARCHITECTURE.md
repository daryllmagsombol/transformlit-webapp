# Community App Architecture (MVP)

Date: 2026-05-27

## Goals

- Enterprise-ready baseline with a small MVP scope.
- Multi-tenant, email/password auth (no social SSO).
- No realtime or websockets in v1; short polling for chat.
- Azure App Service deployment for MVP.
- Page flow: public home (login/register) -> announcements home after login.
- Persistent left sidebar + top bar for authenticated pages.

## Scope (MVP)

- Groups (create, join, roles, membership management)
- Friends (requests, acceptance, block/unfriend)
- Chat (direct and group chat via polling)
- Announcements (tenant-wide home feed after login)
- Read a book (PDF viewer, protected access)

## Out of Scope (for now)

- Realtime chat, typing indicators, read receipts across devices
- Mobile apps
- Recommendation engine
- Payments or subscriptions
- Advanced search and discovery

## Architecture Summary

- Monorepo (Turborepo) with separate apps for API and Web.
- NestJS API for all business logic and data access.
- Next.js web for UI and server-side rendering.
- Shared package for types and DTOs to keep contracts aligned.
- Navigation: Friends, Groups, Books (Documents) in the left sidebar.

## Repository Layout (planned)

- /apps/api NestJS API
- /apps/web Next.js web app
- /packages/shared Shared DTOs, types, validation helpers
- /infra Azure deployment artifacts (optional for MVP)

## Data Model (Core Entities)

- Tenant
  - id, name, slug, status, created_at
- User
  - id, tenant_id, email, password_hash, status
- Profile
  - user_id, display_name, avatar_url, bio
- Friendship
  - requester_id, addressee_id, status
- Group
  - id, tenant_id, name, description, visibility
- GroupMember
  - group_id, user_id, role, status
- Conversation
  - id, tenant_id, type (direct|group), group_id
- Message
  - id, conversation_id, sender_id, body, created_at
- Document
  - id, tenant_id, title, blob_path, access_level
- DocumentAccess
  - document_id, user_id, group_id, access_type
- Announcement
  - id, tenant_id, title, body, status, publish_at, expires_at, created_by, created_at, updated_at

Tenant isolation strategy: shared database with tenant_id on all rows.

## API Design (MVP)

- Auth
  - POST /auth/register
  - POST /auth/login
  - POST /auth/logout
  - GET /auth/me
- Tenants
  - POST /tenants
  - GET /tenants/:tenantId
- Users
  - GET /users/:id
  - PATCH /users/:id
- Friends
  - POST /friends/request
  - POST /friends/accept
  - DELETE /friends/:id
  - GET /friends
- Groups
  - POST /groups
  - GET /groups
  - GET /groups/:id
  - POST /groups/:id/join
  - POST /groups/:id/leave
- Chat (polling)
  - GET /conversations
  - POST /conversations
  - GET /conversations/:id/messages?cursor=...
  - POST /conversations/:id/messages
- Documents
  - POST /documents
  - GET /documents
  - GET /documents/:id
  - GET /documents/:id/stream
- Announcements
  - GET /announcements
  - GET /announcements/:id
  - POST /announcements
  - PATCH /announcements/:id
  - POST /announcements/:id/publish
  - POST /announcements/:id/unpublish
  - DELETE /announcements/:id

## Frontend Stack (MVP)

- Next.js App Router with server components where it helps SEO and routing.
- Tailwind CSS with a small design system (tokens for color, spacing, typography).
- Brand system: logo-driven orange/black with one secondary accent.
- Reusable UI primitives: button, input, card, modal, toast, and layout shell.
- Tanstack Query for server state and caching.
- Redux Toolkit for client-only UI state (filters, local preferences, layout).

## Chat (No Realtime)

- Short polling every 5-10 seconds from the client.
- Cursor-based pagination for messages.
- Keep schema and endpoints compatible with future websocket upgrade.

## PDF Reading Flow

- PDF uploaded to Azure Blob Storage.
- API stores metadata and access rules.
- API streams PDF via authorized endpoint.
- No public blob URLs for protected content.

## Auth and Security

- Email/password auth only for MVP.
- Password hashing using a strong algorithm (argon2 or bcrypt).
- JWT or secure session cookies for API access.
- Rate limiting on auth and chat endpoints.
- Audit logs for group membership and document access.

## Data Access, Migrations, and Seeders

- Prisma ORM for NestJS with migrations tracked in version control.
- Seed scripts for fast local and test environment setup.
- Seed data includes: tenant, admin user, sample groups, announcements, and PDF metadata.
- Keep seeders idempotent and safe for repeat runs in development.

## Azure Deployment (MVP)

- Azure App Service (single app) for initial release.
- Azure Database for PostgreSQL for relational data.
- Azure Blob Storage for PDFs.
- Optional Redis for caching and rate-limits if needed.

Recommendation: split API and Web into separate App Services for enterprise scale and safer deployments once traffic grows or realtime features start.

## Observability and Ops

- Structured logging (request id, tenant id, user id).
- Centralized logs and metrics (Azure Monitor/App Insights).
- Backups for PostgreSQL and Blob Storage.
- CI/CD with staging and production slots.

## Risks and Follow-ups

- Single App Service limits independent scaling.
- Polling chat increases API load; consider websocket when adoption grows.
- Multi-tenancy needs strict tenant_id enforcement and testing.

## Next Milestones

- Confirm tenant model and auth approach (JWT vs session).
- Define DTOs and API contracts.
- Design announcements permissions and home feed ordering.
- Set up Tailwind + design system primitives for the initial UI.
- Decide on background jobs for notifications and moderation.
