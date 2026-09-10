# Secure Ebook Reader — Design Spec

**Date:** 2026-09-10
**Status:** Draft — pending user review
**Scope:** In-app ebook reader for PDF and EPUB with piracy-minded protection: page-by-page delivery, per-user watermarking, reading sessions, rate limiting, annotations (bookmarks/highlights), ToC navigation, page jumping, reading modes and reading settings.

---

## Overview

The app already has `Book` metadata, `BookAccess` entitlements, `BookProgress`, `Bookmark`, `Highlight` models, and a `BooksService.streamPdf()` that is **not exposed** by any endpoint. The web "Read" button is a stub (`books-client.tsx:131` shows a "Reader opening soon." toast). There is no PDF/EPUB viewer, no conversion pipeline, and no background job infrastructure.

This spec defines the reader end to end: content ingestion and conversion, protected delivery, the web reader, annotations, and verification.

### Honest guarantee (read this first)

The product goal is **deterrence plus accountability for paid-book piracy**, not DRM. What this design *does* deliver:

- No one-click whole-book download. The raw PDF/EPUB is never reachable from a browser; content is served page by page through authenticated endpoints with no public URLs.
- Every served PDF page is watermarked with the reader's identity; every page view is audit-logged. A leaked page or screenshot traces to the account that viewed it.
- Scraping is rate-limited and flagged; sessions are short-lived and revocable.

What it *cannot* deliver, and the spec does not pretend otherwise: a determined user can still capture pages one at a time (devtools, screenshots, screen recording, access to their own session). "Cannot download the book" means "no bulk download, every copy is traceable."

---

## Design Decisions

- **Formats:** PDF and EPUB. Format detected at upload (PDF `%PDF-` magic; EPUB is a zip with `application/epub+zip` mimetype entry).
- **Normalization:** both formats become an ordered list of immutable **pages**. PDF pages are rasterized WebP images; EPUB pages are deterministic, server-defined content chunks (sanitized HTML strings). Page numbers, ToC→page mapping, bookmarks, and highlights are stable across devices.
- **Conversion happens once, at upload**, in a separate worker process. Nothing heavy runs on the API event loop. No Redis/BullMQ for v1: a durable DB-backed job table with `FOR UPDATE SKIP LOCKED` claiming is sufficient and adds no infrastructure.
- **Originals are stored outside any web-served path** and are never served by an endpoint. The existing `blobPath` column is reused as the original's storage key (no parallel `storageKey` field).
- **Storage abstraction:** a provider-neutral `StorageAdapter` (no `getPublicUrl`) with a local-filesystem implementation now and an Azure implementation later; the existing `BlobService` (and ideally `UploadsService`) is refactored onto it so the repo does not grow a third divergent storage path.
- **Delivery is REST, not GraphQL.** Page bytes and entitlement checks live on dedicated REST endpoints. GraphQL keeps metadata/annotations/progress.
- **Page authentication uses a scoped reading-session cookie.** The access token is header-only and memory-only, and `<img src>` cannot send headers; the CSP (`next.config.ts:28`) does not allow `blob:` images. `POST /books/:id/reading-session` (Bearer-authed) sets a short-lived, httpOnly, `SameSite=Strict`, read-only cookie scoped to the books path; pages then load as plain `<img src>` / `fetch`. All mutating operations stay on the Bearer path, so the cookie is CSRF-irrelevant. Tokens never appear in URLs, referrers, or logs.
- **EPUB content is never served as `text/html`.** Sanitized fragments are returned as JSON strings and rendered through a sanitize→AST→React path (`rehype-sanitize`/`hast-to-react` or equivalent). Never `innerHTML`. This closes the stored-XSS vector on the app origin, whose CSP allows `'unsafe-inline'` (`next.config.ts:19`).
- **`next/image` is forbidden for protected content** — the optimizer proxies and caches bytes under a stable app-origin URL. Raw `<img>` only; a test enforces no `/_next/image` usage for book pages.
- **Watermark:** per-user, applied server-side. PDF pages are composited at serve time (cached per user+book+page+contentVersion for a short TTL, since the mark is identity-stable, not time-stable — the audit log carries "when"). EPUB fragments get watermark markup injected server-side at serve time (weaker guarantee than baked pixels — documented limitation). Visible watermark only for v1; steganographic text marking is a v2 candidate.
- **EPUB pagination (revised):** server-defined fixed pages. The client never decides pagination. Font size = whole-page zoom so pagination never drifts. A "page" is a deterministic content chunk, so visual fill varies slightly by device — accepted trade-off for stable page numbers.
- **Canonical annotation anchors are locators, not rects.** `{ pageIndex, start, end, prefix, suffix, textHash, rects? }`, with `contentVersion` stored in its own column (single source of truth — not duplicated inside the JSON). `start`/`end` are **word-index ranges for PDF** (from the server's word boxes) and **character offsets within the page fragment for EPUB**. `rects` are cached render hints only. `Bookmark` gains an anchor too (page N alone drifts under re-conversion).
- **Seeded/legacy books:** `format` and conversion statuses are nullable/`NOT_APPLICABLE` so the four seeded books (no `blobPath`, `totalPages` set) do not advertise a reader that can never open. The Read affordance is gated on `conversionStatus = READY`.
- **Re-conversion is versioned.** `Book.contentVersion` bumps; page rows are replaced transactionally; anchors that fail to re-resolve are listed but not drawn (orphan UX).
- **Honest CSP note:** `img-src` gains the dev API origin (`http://localhost:3005`) and nothing else. No `blob:`. Prod is same-origin (`next.config.ts:3-7`).

---

## Architecture

```
Upload (PDF | EPUB, existing GraphQL multipart, 50 MB cap)
  └─> StorageAdapter.put(original key)            # protected dir, never web-served
  └─> BookConversionJob row (PENDING)
        └─> worker process (separate entrypoint, polls DB)
              ├─ PDF  → render page → WebP + extractTextItems → bboxes JSON
              └─ EPUB → parse spine → sanitize → deterministic page chunks
                        + extracted assets (images/fonts)
              └─> BookPage rows + BookTocEntry rows + pageCount
                  + contentVersion++ → conversionStatus = READY | FAILED

Reader open (web: /books/[id]/read)
  └─> GraphQL: book manifest (title, format, pageCount, toc, conversionStatus)
  └─> POST /books/:id/reading-session  (Bearer) → httpOnly scoped cookie
  └─> GET /books/:id/pages/:n/frame    (cookie) → WebP image (PDF)
  └─> GET /books/:id/pages/:n          (cookie) → JSON { kind:'pdf', text, words[] } | { kind:'epub', html }
  └─> GET /books/:id/assets/:key       (cookie) → EPUB image/font asset
  └─> GraphQL: progress / bookmarks / highlights (Bearer)
```

### Conversion worker

- Separate process: `apps/api/src/worker/main.ts` (exact script name set in the plan), started alongside the API locally and as its own container in deploy.
- Claim query: `UPDATE book_conversion_jobs SET status='PROCESSING', lockedAt=now() WHERE id = (SELECT id FROM book_conversion_jobs WHERE status='PENDING' AND (lockedAt IS NULL OR lockedAt < now() - interval '15 minutes') ORDER BY createdAt ASC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`.
- Poll ~2 s; max 3 attempts with backoff; on final failure set `Book.conversionStatus = FAILED` + `conversionError`. Admin retry mutation exists.
- PDF: `unpdf` (official `pdfjs-dist` + `@napi-rs/canvas` + bundled standard fonts), pinned to a known-good `pdfjs-dist` (E1 spike; 4.7.x known-good line, 5.3/5.4 have documented Node/bundler failures). Fixed render DPI → WebP. `extractTextItems` per page → word `{ t, x, y, w, h }` normalized boxes.
- EPUB: `@likecoin/epub-ts` (Node entry) → spine + nav; `sanitize-html` with a strict allowlist (no `script`, `on*`, `javascript:`, SVG/MathML, `style` `url()`/`@import`, `iframe`, `form`); deterministic chunking via `locations.generate()` (fixed character budget per page); assets extracted to protected storage with size caps; zip-bomb/path-traversal/external-entity protection; no network fetches (no SSRF).
- Re-conversion: transactional replace of `BookPage`/`BookTocEntry`, `contentVersion++`, old assets deleted after commit.

---

## Data Model (Prisma additions)

```prisma
enum BookFormat {
  PDF
  EPUB
}

enum ConversionStatus {
  NOT_APPLICABLE   // legacy/seed books with no file
  PENDING
  PROCESSING
  READY
  FAILED
}

model Book {                         // additions only
  // blobPath is REUSED as the original file's storage key.
  format           BookFormat?
  pageCount        Int?              // authoritative once READY; totalPages is legacy
  conversionStatus ConversionStatus  @default(NOT_APPLICABLE)
  conversionError  String?
  contentVersion   Int               @default(1)

  pages            BookPage[]
  tocEntries       BookTocEntry[]
  conversionJobs   BookConversionJob[]
  readingSessions  ReadingSession[]
  pageViews        PageView[]
}

model BookPage {
  id        String   @id @default(uuid())
  bookId    String
  book      Book     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  index     Int
  assetKey  String                   // frame image (PDF) or page fragment JSON (EPUB)
  textKey   String?                  // extracted text / word boxes
  width     Int?
  height    Int?
  charCount Int?
  createdAt DateTime @default(now())

  @@unique([bookId, index])
  @@map("book_pages")
}

model BookTocEntry {
  id     String @id @default(uuid())
  bookId String
  book   Book   @relation(fields: [bookId], references: [id], onDelete: Cascade)
  title  String
  page   Int
  depth  Int    @default(0)
  order  Int

  @@index([bookId, order])
  @@map("book_toc_entries")
}

model BookConversionJob {
  id        String    @id @default(uuid())
  bookId    String
  book      Book      @relation(fields: [bookId], references: [id], onDelete: Cascade)
  status    String    @default("PENDING")   // PENDING | PROCESSING | READY | FAILED
  attempts  Int       @default(0)
  lockedAt  DateTime?
  lastError String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@index([status, createdAt])
  @@map("book_conversion_jobs")
}

model ReadingSession {
  id         String    @id @default(uuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookId     String
  book       Book      @relation(fields: [bookId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  expiresAt  DateTime
  revokedAt  DateTime?
  lastSeenAt DateTime  @default(now())
  createdAt  DateTime  @default(now())

  pageViews  PageView[]

  @@index([userId, bookId])
  @@index([expiresAt])
  @@map("reading_sessions")
}

model PageView {
  id             String         @id @default(uuid())
  sessionId      String
  session        ReadingSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId         String
  bookId         String
  page           Int
  contentVersion Int
  viewedAt       DateTime       @default(now())

  @@index([bookId, viewedAt])
  @@index([userId, viewedAt])
  @@map("page_views")
}

// Existing models — additive, nullable changes only:
model Bookmark {
  anchor         Json?   // { pageIndex, start, end, prefix, suffix, textHash, rects? }
  contentVersion Int?    // version the anchor was computed against
}

model Highlight {
  anchor         Json?   // same shape as Bookmark.anchor; rects cached under anchor.rects
  contentVersion Int?    // version the anchor was computed against
}
```

Notes:
- `lastIp` / `userAgent` intentionally **not** stored on `ReadingSession` (personal data; breaks behind proxies/mobile).
- `PageView` retention: periodic sweep (e.g. 90 days) + batched writes under load.
- `totalPages` is deprecated: keep for backward compatibility, treat `pageCount` as authoritative when `conversionStatus = READY`.
- New enums go to `packages/shared/src/enums.ts` + `registerEnumType` + shared GraphQL/Zod types, following the `BookAccessLevel` pattern (`book.model.ts:4-5`).

---

## API Surface

### New REST endpoints (`BooksController`, cookie or Bearer as noted)

All endpoints re-check on **every** request: book exists, `deletedAt = null`, `status = PUBLISHED`, `conversionStatus = READY`, and entitlement (`accessLevel = FREE` OR owner OR a `BookAccess` row). This fixes the existing gaps where `streamPdf` ignores `deletedAt` (`books.service.ts:81`) and `findById` ignores its `userId` param (`books.service.ts:33-37`).

- `POST /books/:id/reading-session` — **Bearer**. Validates entitlement; creates `ReadingSession` (hashed token, ~15 min sliding); sets cookie `transformlit_reader` (`httpOnly`, `SameSite=Strict`, `Secure` in prod, `Path=/books`); returns `{ expiresAt }`.
- `GET /books/:id/pages/:n/frame` — **cookie**. Returns `image/webp` for PDF books; 404 for EPUB books (which have no frame image). Headers: `Cache-Control: no-store, private`, `Vary: Cookie`, `X-Content-Type-Options: nosniff`. Records `PageView` (batched).
- `GET /books/:id/pages/:n` — **cookie**. JSON: PDF → `{ kind: 'pdf', text, words[] }`; EPUB → `{ kind: 'epub', html, page }`. Never `text/html`.
- `GET /books/:id/assets/:key` — **cookie**. EPUB image/font assets; extension/content-type allowlist; size caps.

Rate limiting: `ThrottlerModule` wired **per-route** (not globally), tracker keyed on `userId + bookId`, thresholds set relative to legitimate prefetch (start ~90 pages/min, burst 10). v1 assumes a single API replica; Redis-backed store is the scale-up path. Sustained overspeed → temporary pause + audit flag.

### GraphQL (existing module, additive)

- `book(id)` gains `format`, `pageCount`, `conversionStatus`, `toc: [BookTocEntry]`. Storage keys are never exposed.
- `retryBookConversion(bookId: ID!): Book!` (owner/ADMIN/MODERATOR).
- Existing `saveProgress` / `bookmarks` / `highlights` keep their shapes; inputs gain optional `anchor` where applicable.

---

## Web Reader (UX summary)

Grounded in `docs/DESIGN_SYSTEM.md` and the existing bible-reader patterns; full interaction inventory retained from the approved design.

- **Route:** `(reader)/books/[id]/read` — a new immersive route group (the repo's first outside `(app)`) with a minimal layout (Apollo + Toast providers, `useRequireAuth()`); no app TopBar/Sidebar/BottomNav. Reachable from the books list Read button (`books-client.tsx:131`) and the resume card.
- **Regions:** `ReaderTopBar` (back, title, page indicator, mode toggle, panel triggers, auto-hide), `PageViewport`, mobile `ReaderBottomBar`, `TocPanel`, `AnnotationsPanel` (Bookmarks/Highlights tabs), `SettingsSheet`, `PageJump`, `SelectionActionBar`, `WatermarkOverlay`, connection/session banners.
- **Responsive:** mobile → single page, panels as bottom sheets (existing `Sheet`); tablet → single page + right-side overlay panels; desktop → dockable ToC (280 px) + Annotations (320 px).
- **Modes:** paged (default) and continuous scroll; ≤5 pages in memory; prefetch current ±1 (scroll: ±2 render). No whole-book fetch, no IndexedDB, no service worker for content.
- **Features:** page number + jump; ToC→page; bookmarks (toggle/list/jump); highlights (select → action bar → color/note; no copy affordance); reading settings (theme light/dark/sepia/warm-paper scoped via `data-reader-theme`, page-zoom font size); single-page layout only in v1 (two-page spread is deferred — see Non-Goals); progress auto-save (debounced, on page settle, on tab hide) and resume chip consistent with the bible reader; URL state `?page=` + `#a{id}`/`#b{id}` for deep-linkable annotations.
- **Highlighting:** PDF = transparent text layer from server word boxes (absolutely positioned spans using stored bboxes — no browser font-metric alignment), highlights drawn as rects over the raster. EPUB = inline `<mark>` re-derived from anchors at render. Context-menu interception scoped to non-text regions so long-press-to-select still works.
- **A11y:** keyboard map (arrows/PageUp/PageDown/Space/Home/End/Escape, Shift+arrows for selection), focus-trapped panels (upgrade the shared Sheet/Modal primitive — it currently does not trap focus despite `DESIGN_SYSTEM.md:329`), polite live region on explicit navigation only, `aria-hidden` raster with accessible text layer, visible focus, 44 px targets.
- **Failure states:** session expiry → in-viewport non-disruptive re-auth keeping the current page; offline → banner + retry card, fetched pages stay readable; overspeed → calm non-error pause with countdown; access denied / not-ready / conversion-failed states; per-page retry.
- **Reduced motion:** `useReducedMotion()` from `motion` (global CSS only disables CSS transitions, `globals.css:233-238`).

---

## Verification

- **Spikes first (before schema freeze):**
  1. PDF render: pinned `pdfjs-dist` + `@napi-rs/canvas`, 300+ page PDF → WebP + word boxes; memory/throughput in the target runtime (musl/arm64 if containerized).
  2. EPUB determinism: real EPUBs → `locations.generate()` chunking → stable page fragments + ToC mapping.
  3. Watermark throughput: sharp per-page composite cost, cache-TTL strategy validation.
  4. Job model: DB queue claim/retry under load; separate process vs `worker_threads`.
  5. Page auth: reading-session cookie across dev (3000→3005, same-site localhost) and CSP `img-src` dev addition.
- **API unit (Jest):** conversion state machine, entitlement + soft-delete checks on every endpoint, session issue/expire/revoke, throttle tracker, watermark composer, storage adapter (local), anchor resolution/re-anchoring.
- **API integration (testcontainers, existing pattern):** upload → job → convert → serve page; user isolation; **security tests**: no endpoint ever returns the raw file or storage key; soft-deleted/PUBLISHED/DRAFT gating; XSS corpus (script/onerror/SVG/mXSS/style-url) sanitized; zip-bomb/traversal rejection.
- **Conversion golden tests:** sample PDF + EPUB fixtures → page counts, dimensions, text presence, sanitizer output snapshots.
- **Web unit (Jest + RTL):** reader store, prefetch window, keyboard map, progress debounce, both page renderers, no-`/_next/image` assertion for protected content.
- **E2E (Playwright, existing harness):** open → turn → ToC jump → bookmark → highlight → settings → reload/resume; negative test: no download/print affordance reachable from the reader.

## Build Order

Spikes → schema + shared enums → StorageAdapter (+ refactor `BlobService`) → conversion worker (PDF) → REST delivery + reading session + throttler → reader shell (PDF, paged) → annotations → EPUB pipeline + fixed pages → settings/scroll/spread → hardening (watermark serving, EPUB assets, orphan UX, retry/admin, retention sweep) → verification throughout.

## Non-Goals (v1)

Purchase/grant flow (restricted books still rely on manual `BookAccess` rows; the Buy button stays a stub), two-page spread pairing polish (ship single page first), offline/IndexedDB caching, steganographic EPUB text marking, multi-replica throttling store, admin download endpoint for originals, bulk-scrape ML detection (throttle + audit only).

## Open Risks

- EPUB text is intrinsically copyable; the EPUB guarantee is weaker than PDF's baked-pixel watermark. Rasterizing EPUB would equalize it at the cost of text selection and a heavy worker — deferred.
- Cross-browser CSS differences are now contained (server-defined pages), but `.epub` publisher styles are stripped; some books may look plainer than their original design.
- `sharp` wraps libvips (LGPL-3.0, dynamically linked) — confirm bundling policy with legal during implementation; low risk.
- Every served page that misses the user+page cache costs a decode/composite/encode. Prefetch and the short-TTL cache mitigate; monitor in the spike.
