# Transformlit PWA and Offline Reading Design

**Status:** Approved by user for automatic execution; implementation has not started.  
**Date:** 2026-10-01

## Intent and success criteria

Make the Transformlit web app installable and provide reliable offline reading of content that a user explicitly saved. Offline support is intentionally limited to reading and reader-related edits; it is not a general offline mode for chat or social features.

Success means:

- Users can install the app with correct name, icons, standalone presentation, and a predictable update flow.
- A previously signed-in account can open a non-personalized offline hub after a cold browser restart and read complete, explicitly downloaded Bible chapters and Transformlit books without network access.
- Interrupted or incomplete downloads never appear ready, and an updated book never mixes content versions.
- Book reading progress, bookmark add/remove, and note/highlight create/update/delete actions survive restart and synchronize safely after connectivity returns.
- Conflicting note/highlight edits preserve both the server version and the offline edit for resolution; retries do not duplicate records.
- Account-specific content and queued edits never cross account boundaries. Sign-out requires successful sync or explicit discard.
- The service worker never caches personalized API/page data or returns app fallback HTML for Next.js RSC requests.

## Product scope

### Included

- Installability and a minimal offline hub/fallback.
- Explicit user-selected offline downloads: individual Bible chapters and whole Transformlit books.
- Offline reading of downloaded content.
- Queued book-reader edits: reading progress, bookmarks, notes, and highlights.
- Durable foreground synchronization, conflict handling, account lifecycle controls, storage/quota handling, and update prompts.

### Excluded for v1

- Offline Bible mutations. Bible downloads are read-only; Bible position remains a local navigation preference.
- Chat, groups, friends, notifications, realtime subscriptions, remote search, audio, and other network-dependent/social functions.
- Broad caching of authenticated pages, GraphQL responses, RSC payloads, or other personalized server responses.
- General-purpose event sourcing, CRDT infrastructure, or offline mutation support across the rest of the product.
- Browser storage as DRM or a guarantee of immediate permission revocation while disconnected.

## Current constraints and evidence

- The frontend is a Next.js 16.3 App Router application using React 19 and `output: 'standalone'`; no manifest, service worker, or PWA library currently exists.
- The authenticated shell and book reader are separate route/layout flows. The reader's page/session retrieval depends on network APIs, so offline restart requires a local content path rather than only retaining a route shell.
- The reader store persists page position in localStorage, while server progress is best-effort and debounced. There is no durable mutation outbox.
- The API has authenticated book progress, bookmark, and highlight operations. Book progress is an unconditional upsert; bookmark/highlight creates have no idempotency key or client entity ID; no revision precondition exists. The web reader has not wired bookmark/highlight operations, and note text is part of a highlight rather than a standalone note model.
- Access tokens are memory-only and refreshed through an HttpOnly cookie. A network/refresh failure currently affects authentication state and needs to be distinguished from genuine invalid credentials for offline use.
- Bible content comes from an external provider. The Bible Zustand store persists translation and last position, not the chapter content.
- Deployment documentation describes Azure Container Apps, Cloudflare, and a Next standalone deployment. Actual container/CDN behavior and response headers must be verified in implementation planning.
- The current CSP has no explicit `worker-src` directive.

## Architecture

### 1. PWA shell and service worker

Use the Next.js App Router manifest convention (`app/manifest.ts` or equivalent) for install metadata. Serve a same-origin root-scoped `/sw.js` and register it from client code. The worker is limited to:

- Versioned, non-personalized app assets required by the offline hub and locally rendered readers.
- A non-personalized navigation fallback for document navigations when offline.
- Worker lifecycle/update notification.

Do not place authentication, user data, downloaded reading content, or mutation replay in the service worker. Do not cache GraphQL, auth, protected page/session endpoints, personalized HTML, or RSC responses. Navigation fallback handling must distinguish document navigations from Next RSC/data requests and must never answer an RSC request with HTML.

Version static shell caches independently from IndexedDB. Worker activation/update must not delete account content or queued work. Prompt users before applying an update that could replace currently running code; do not force reloads or unconditionally skip waiting.

### 2. IndexedDB offline store

IndexedDB is the single persistence authority for offline content, local reader records, and the transactional outbox. Zustand remains responsible for transient UI state and preferences; migrate or namespace existing persisted reader state as needed to avoid duplicated authorities.

Private records are partitioned by immutable account subject. The store must support transactional migrations and contain at least:

- Download manifests and per-item readiness/version state.
- Bible chapter content and navigation metadata.
- Book metadata, table of contents, rendered pages, and text layers.
- Local reader records (progress, bookmarks, highlights/notes and conflict copies).
- Durable outbox operations and server idempotency acknowledgements.
- Account-scoped lifecycle/sign-out barrier state.

Commit a local edit and its outbox operation atomically. Report an edit as saved on this device only after transaction completion. Request persistent browser storage when available, estimate/report quota, surface storage failures, and never automatically evict pending edits.

### 3. Download manager and content contracts

Downloads are explicit user actions with visible progress, completion, removal, and recoverable errors. Stage the new dataset in a non-ready state, verify all required items, then atomically publish a ready marker. Preserve the last complete book version until its replacement has completed. Removing downloaded content must not silently erase queued annotations or other unsynced edits.

For Bible chapters, store the chapter text and sufficient translation/book metadata for offline navigation. Verify redistribution/licensing conditions for each translation before enabling offline downloads. Audio, remote search, and optional remote enrichment are not included unless separately designed.

For a whole Transformlit book, add an authenticated, content-version-pinned download manifest that covers all required metadata, TOC, rendered pages, and text layers. The existing `contentVersion` can anchor consistency only if the download API returns a version-pinned complete set. Do not build bulk downloads by rapidly crawling current reading-session/page endpoints: they are session-dependent/throttled, record reading analytics, and can produce mixed versions during publication changes.

**Approved retention policy:** book downloads remain available until the user removes them or signs out. This is browser-profile-local storage, not DRM: a user can clear browser data, and permission revocation cannot be enforced while the device is offline. When online, normal server authorization still governs new downloads and network access; a server-side revocation cannot erase a previously downloaded copy without the client reconnecting.

### 4. Reader repositories

Introduce application-level repositories that expose reading content to existing reader UI from either the network or the offline store. Components should not branch on storage implementation. Offline reader entry must not require a network reading session; saved content must open through the offline hub after a cold restart.

The book repository validates the requested content version and ready state before opening. The Bible repository resolves saved chapter text and navigation metadata. Features that need unavailable network resources (including remote search, audio, and realtime) must be clearly unavailable offline rather than silently appearing functional.

### 5. Mutation and synchronization contract

Use one application mutation path for online and offline reader edits:

1. Apply the edit locally and append an outbox operation in one IndexedDB transaction.
2. Trigger foreground sync on app launch, reconnection, focus, and explicit retry.
3. Send operations using the authenticated server API, in order for each entity. Operations with dependencies (for example, an edit after an in-flight create) wait for the preceding acknowledgement and use its returned server ID/revision.
4. Transactionally record acknowledgements and receipts. Apply server state only if no newer local edit exists; otherwise advance the next pending operation's base revision only after a successful write to the intended entity, without replacing its local payload. Remove only the acknowledged operation and create any conflict records.

Each operation carries a stable operation ID, client-generated entity ID where applicable, base revision, relevant content version, and operation payload. The server derives ownership from authenticated identity; it must not trust a submitted user/account ID. Every operation type—including progress writes, creates, updates, and deletes—must have replay-safe semantics. Server mutations and deduplication receipts must commit atomically so a repeated operation returns the prior result rather than duplicating or reapplying an edit. Because users may remain offline indefinitely, operation receipts (or an equivalent permanent uniqueness record) must remain valid for as long as the corresponding local operation could be replayed; no short expiry is allowed.

Background Sync may be used as a best-effort enhancement where supported, but it is not part of the correctness guarantee. Foreground retry is mandatory. Do not persist access tokens or move authenticated mutation replay into service-worker code.

#### Server/API changes required

- Add idempotency support for every queued mutation: progress writes, bookmark add/remove, highlight/note creates and updates, and retry-safe deletes.
- Add revision/base-version checking for progress and highlight/note writes and define ordered update operations.
- Expose annotation anchors and content-version provenance consistently in inputs and outputs; these fields are required for offline/versioned rendering, not optional.
- Add an authoritative per-book annotation snapshot API (including deletions/tombstones and conflict copies) for refreshing server changes from other devices. Merge snapshots with pending local operations; do not add a general change-feed subsystem for v1.
- Ensure authorization is enforced by current authenticated user and book access rules.
- Provide a version-pinned book download contract distinct from session-dependent reading endpoints.
- Define a Bible local-download contract and verify translation usage rights; no Bible edit API is required for v1.

### 6. Conflict behavior

- **Notes/highlights:** compare base revision on the server. If stale, preserve the current server record and create a durable, visibly linked conflict copy from the offline edit. Replaying the same operation returns the same conflict result/copy. Concurrent deletes versus edits must preserve the edited content along with deletion history rather than silently lose it.
- **Bookmarks:** v1 supports add/remove only; editing label/color is excluded. Use stable client-generated entity IDs and idempotent create/delete behavior. Use deletion tombstones or equivalent ordering protection so a delayed retry cannot resurrect a deleted bookmark.
- **Reading progress:** coalesce unsent operations by `(account, book)` only while they have not been sent. Never alter an in-flight operation. Do not use highest-page-wins or replay-arrival-wins. Use revision conflict detection and let the user explicitly choose local or server resume position.

Annotation refresh merges authoritative per-book snapshots with local records by stable entity ID and revision. Pending local operations remain authoritative over older snapshot values until acknowledged or resolved; snapshots never automatically rebase pending operations onto a server revision the user has not reconciled. Server deletions are retained as tombstones so stale local records/retries cannot resurrect them. If an operation conflicts, pause subsequent operations for that entity until resolution. Resolution explicitly chooses the server record, keeps the offline edit as a conflict copy, or retargets a later edit to that conflict copy using its ID and revision. No CRDT library, general event-sourcing system, or general change-feed subsystem is needed for this scope.

### Content-version provenance

Every saved or queued book annotation records the book content version and any page/text anchor against which it was created. Updating a downloaded book must not reinterpret an annotation against new page content. Retain the referenced old content version while it is needed by saved/pending annotations, or preserve the annotation as a visibly unresolved/orphaned record if that version is no longer available. Pending operations keep their original version; the server must reject or return an explicit conflict for an unavailable/incompatible version rather than silently remapping it.

### 7. Account lifecycle and privacy

“Device-bound” means local to the browser profile/origin, not tied to hardware. Installed PWAs and browser tabs can share origin storage. Namespace data by immutable authenticated subject, coordinate tabs with a sync lease/locking mechanism and cross-tab notification, and reject stale sync results when ownership changes. Switching accounts uses the same gate as sign-out: freeze new writes; sync pending work or require explicit discard; establish the lifecycle barrier; then clear the old account's data before activating a different subject. A refresh/login result for a different subject cannot bypass this gate. Cross-tab account switches must acquire the same lifecycle lock.

Distinguish offline access to an established local account from current server authentication. Network errors and server outages pause sync but do not destructively clear account data. Genuine authentication failure pauses replay and requires reauthentication as the same account; verify the refreshed token subject matches the outbox owner before sending anything. Do not persist access tokens.

Sign-out and account switching are coordinated across tabs:

1. Acquire the account lifecycle lock, freeze new writes, and block automatic account restoration while the operation is in progress. Sync is paused only for new edits; an explicit controlled drain of existing operations may continue.
2. Drain pending work while online, or require explicit user confirmation to discard it. An account switch follows this exact same gate.
3. Persist a durable sign-out/switch barrier before destructive cleanup. Reject late refresh/login results for the old subject while the barrier is active.
4. Invalidate in-flight sync results. Serialize remote logout and new login as one lifecycle operation. When online, call the existing server logout/session invalidation flow and wait for it to settle and clear/expire the old HttpOnly cookie before permitting another login. If offline, or if the remote logout times out/fails, persist a deferred logout marker; local sign-out and account-data cleanup may complete, but local UI remains signed out and all login/account activation is blocked until connectivity returns and old-session invalidation completes. This prevents a delayed logout request/response from invalidating or clearing a newly established account session.
5. Clear the old account's content, outbox, and account-specific state only after the sync/discard decision and barrier are durable. Activate a different account only after old-account cleanup and any required remote logout have completed.

Permanent sync failures need actionable retry/recovery/discard UX. Account namespacing does not protect against same-origin XSS or use of an unlocked browser; do not claim otherwise. Do not encrypt data with a key stored alongside it as if that protected against those threats.

## Deployment and update requirements

- Serve `/sw.js` from the same origin with JavaScript MIME type, `Cache-Control: no-cache, no-store, must-revalidate`, and explicit CSP `worker-src 'self'`.
- Verify the actual standalone container and Cloudflare path serve `public/`, `.next/static`, the manifest, worker, icons, and shell chunks. The standalone output directory omits public/static assets by default unless the deployment copies or serves them separately.
- Ensure Cloudflare/reverse-proxy rules preserve the intended service-worker content type and cache headers.
- Retain hashed assets needed by old open tabs/workers through rolling deployments; validate client/server compatibility during rollout.
- Keep worker cache cleanup separate from IndexedDB/download cleanup. IndexedDB schema migrations must be transactional and non-destructive across supported upgrades/rollbacks.

## Rollout and acceptance gates

### Stage 1 — Lock contracts and deployment assumptions

- Inspect the actual container entrypoint, Cloudflare routing, worker/public/static asset behavior, and CSP headers.
- Confirm Bible translation download rights and required offline metadata.
- Define the version-pinned book manifest and bookmark/highlight/progress idempotency/revision contracts.
- Specify quota/error behavior and recovery UX.

**Gate:** contracts, asset-serving path, content completeness, identity ownership, and conflict semantics have testable definitions.

### Stage 2 — Installability and offline hub

- Add manifest/icons and root worker registration.
- Add static-only caching, offline navigation behavior, and update prompt.
- Ensure no API/personalized/RSC response is cached or replaced with HTML fallback.

**Gate:** installability succeeds; after a cold offline restart the hub renders; worker is served through production-like Azure/Cloudflare path with correct CSP and headers.

### Stage 3 — Explicit read-only downloads

- Add IndexedDB schema/download manager and local Bible/book reader repositories.
- Add complete version-pinned book download and Bible chapter download.
- Implement stage/verify/ready, update, remove, storage quota, and interrupted-download handling.

**Gate:** downloaded chapters/books open after full browser restart offline; incomplete or mixed-version data never appears ready; update/removal/quota failure is recoverable.

### Stage 4 — Online annotation flow and server guarantees

- Wire bookmark add/remove and highlight/note read and write UI for books; bookmark label/color updates remain out of scope for v1.
- Add idempotency, client IDs, revisions, update and conflict-copy behavior to server contracts.
- Make retries and deletes safe before adding offline replay.

**Gate:** lost responses/retries yield one logical change; stale revisions and delete/edit races preserve required versions; authorization uses authenticated ownership.

### Stage 5 — Local-first edits and account lifecycle

- Route online/offline reader mutations through the local transaction/outbox.
- Add sync coordinator, per-entity ordered replay, coalesced unsent progress, annotation snapshot reconciliation, cross-tab coordination, same-account reauthentication, sign-out/account-switch barrier, and sync/discard flow.

**Gate:** edits survive restart; replay is safe across retries and tabs; account switching never replays the wrong user's work; sync failures are recoverable; sign-out follows the required gate.

### Stage 6 — Production-like release testing

- Test current supported Chromium and iOS browser/installed PWA behavior, flaky connectivity, cold restarts, quota/eviction, multi-tab, account switching, content updates, rolling deployments, worker updates, and IndexedDB upgrade/rollback.
- Verify accessibility and error/status affordances for downloads, conflicts, and pending sync.

**Gate:** all prior gates pass in production-like infrastructure and pending downloads/outbox data survive supported upgrades and rollback scenarios.

## Risks and limitations

- Browser storage can be evicted or manually cleared; persistent storage reduces but does not eliminate that risk.
- Immediate content access revocation is impossible while offline because, by approved policy, downloads remain usable until deletion/sign-out.
- A local logout cannot clear an HttpOnly cookie while fully offline; a durable barrier and explicit reauthentication behavior are required.
- Background Sync is not supported consistently and cannot be the only replay path.
- Existing reader APIs and progress writes must evolve before a reliable offline client can be delivered; the current behavior is not safely replayable as-is.
- The offline shell must account for Next.js RSC/navigation mechanics; generic document fallback behavior is unsafe for App Router data requests.

## Primary references

- Next.js PWA guide: https://nextjs.org/docs/app/guides/progressive-web-apps
- Next.js manifest convention: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
- Next.js standalone output: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Next.js headers configuration: https://nextjs.org/docs/app/api-reference/config/next-config-js/headers
- MDN Service Worker API: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- MDN service-worker caching guidance: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching
- MDN Background Sync limitations: https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API
- MDN CSP `worker-src`: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src
