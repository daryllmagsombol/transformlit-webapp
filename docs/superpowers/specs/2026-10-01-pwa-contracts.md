# PWA Offline Contracts

These contracts refine the approved decisions in `2026-10-01-pwa-design.md`; they do not expand product scope.

## Book download manifest and assets

- An authenticated manifest request identifies a book and pins one immutable `contentVersion` for the entire response.
- The manifest includes book metadata, ordered TOC entries, every rendered page and its required text layer, MIME type, stable versioned asset URL, and integrity metadata (byte length and SHA-256 digest). An absent required item makes the manifest invalid, not partially readable.
- Versioned assets are same-origin authenticated resources whose URL identifies both book and content version. They are immutable for that version; replacing content creates a new version and never changes an existing version's bytes.
- Clients stage all assets under a non-ready download ID, verify count, version, length, and digest, then publish readiness atomically. A failed replacement leaves the previous ready version untouched.
- The manifest is distinct from session-dependent reading endpoints; downloading must not create reading sessions or page-view analytics.

## Annotation anchors and version provenance

- Every book annotation has an immutable client entity ID, server ID when acknowledged, `contentVersion`, revision, and page/text anchor fields sufficient to render against the original content. Required anchor fields are not nullable for a positioned annotation.
- The server derives owner identity from authentication. Submitted account IDs never establish ownership.
- A mutation with an unavailable or incompatible content version returns a classified conflict; it is never silently remapped to current content.

## Operation envelope and results

- Each queued operation contains a stable `operationId`, client entity ID where applicable, operation kind, book ID, content version, base revision, and operation payload. The authenticated principal is the sole owner authority.
- Retries of an operation ID return its durable prior acknowledgement/result and do not repeat the mutation. Mutation and receipt commit atomically; receipts have no short expiry while the operation can still be replayed.
- Results are discriminated as `acknowledged` (including entity ID and new revision), `conflict` (including current server entity/revision and any durable conflict-copy ID), or a classified permanent/transient failure. A conflicting edit preserves both server and offline values.
- Operations for one entity are ordered. Deletes preserve tombstone/order protection; a delayed create/update cannot resurrect a deleted record.

## Snapshot consistency and tombstones

- An annotation snapshot is authoritative for one book at a consistent server snapshot boundary and includes current records plus deletion tombstones and conflict copies.
- Clients merge by stable entity ID/revision. Pending local operations remain authoritative over older snapshot state, and snapshots do not silently rebase them. Tombstones prevent stale records or retries from resurrecting deleted entities.
- An operation conflict pauses subsequent operations for that entity until explicit resolution.

## Account lifecycle, lock order, and failure classification

- Private local records and the outbox are partitioned by immutable authenticated subject; tokens are never persisted.
- Cross-tab operations acquire locks in this order: account lifecycle lock, then per-account sync lease, then per-entity operation serialization. Account activation, switching, and sign-out acquire the lifecycle lock before changing ownership or clearing data.
- Lifecycle transitions freeze new writes, drain pending work or obtain explicit discard consent, persist a durable barrier, invalidate late sync/auth results, complete or defer remote logout, clear the old account, and only then allow another subject to activate.
- Network/server outage is transient and pauses replay without clearing local data. Invalid credentials require reauthentication as the same subject. Subject mismatch, unavailable content version, stale revision, authorization denial, and malformed operation are distinct permanent/actionable classifications; none trigger cross-account replay.

## Quota, incomplete downloads, conflicts, and sign-out UX

- Request persistent storage when supported and report estimated usage/quota. On quota or write failure, retain the previous ready content and all pending edits; never automatically evict outbox records.
- An interrupted/incomplete download is visibly incomplete and cannot be opened as ready. It can be retried or discarded without deleting annotations/outbox state.
- Conflicts visibly preserve both versions and offer explicit server-choice, keep-as-conflict-copy, or retargeted-edit resolution. Permanent failures expose retry/recovery/discard choices appropriate to the classification.
- Sign-out/account-switch is blocked while pending work exists until synchronization succeeds or the user explicitly confirms discard. Offline/failed remote logout leaves a durable logout barrier and prevents account activation until server-session invalidation completes.

## Compatibility window

- The client, API operation envelope, and IndexedDB schema carry explicit versions. A client may read/write only server-supported operation versions; incompatible operations are held for recovery and are never dropped or guessed into a new shape.
- IndexedDB upgrades are transactional and preserve content, pending operations, receipts, and barriers across supported client upgrades and rollbacks. Service-worker cache cleanup is independent of IndexedDB cleanup.
- The supported window is the current deployed client plus the immediately previous still-open client during a rolling deployment. The API accepts both versions during that overlap; deploys must not remove an operation/schema version until the prior client is outside this overlap and no corresponding work can remain in replay.

## Integration fixture contract (prepared in Task 1B)

- Seed two distinct accounts with stable test-only credentials and immutable subjects; never share one account's content or queued work with the other.
- Seed a published, multi-page book readable by the first account with complete metadata, TOC, rendered page assets, text layers, and at least two retained content versions.
- Seed a restricted book that the first account cannot read, so authorization is tested independently of download completeness.
- Keep fixture setup isolated to the owned disposable test database and emit any generated credentials/output only inside ignored repository test artifacts.
