# Seed Data & Local Environment

## Login credentials (real argon2 hashes — usable)

| Email | Password | Role |
|---|---|---|
| `admin@transformlit.com` | `Transformlit123!` | ADMIN |
| `sarah@transformlit.com` | `password123` | MEMBER |

`apps/api/prisma/seed.ts` also creates members: priya, marcus, lucia, thomas,
fatima, elijah, david, emma, sophia `@transformlit.com`.

Seed is **idempotent upserts** — `mem:suggested_commands` for how to run it.

## Seeded groups (all PUBLIC, 7)

`the-bereans` (Theology Explorers, featured), `morning-devotionals` (Morning Readers),
`historical-memoirs`, `modern-fiction-circle`, `art-and-soul`, `global-wisdom`, `nature-voice`.

Note: seed defines PUBLIC groups only, so the join-group "request to join" (PRIVATE)
path cannot be exercised from seed data — you must flip `visibility` in the DB to test it.

## Database facts

- Prisma table names are **snake_case** (`groups`, `users`, `group_members`) and
  column names are **camelCase quoted** (`"userId"`, `"deletedAt"`). Raw SQL must quote them.
- Local: `postgresql://postgres:postgres@localhost:5432/transformlit`; test DB `transformlit_test`.
- Prisma 7 does not auto-load `.env` — source `apps/api/.env` first (see `mem:suggested_commands`).

## Related

- Browser verification login steps: `mem:verification/browser-and-blindspots`
- DB commands + gotchas: `mem:suggested_commands`
