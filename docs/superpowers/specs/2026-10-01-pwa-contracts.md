# PWA Offline Contracts

These contracts refine the approved decisions in `2026-10-01-pwa-design.md`; they do not expand product scope.

## Book download manifest and assets

- `GET /api/books/{bookId}/offline-manifest` requires the current authenticated user and book read permission. It returns the latest published immutable version. Optional query `contentVersion: integer` requests a retained version; unknown versions return `404` and unreadable books return `403`.
- `200 OfflineBookManifest` has required fields: `bookId: string`, `contentVersion: integer`, `title: string`, `author: string | null`, `description: string | null`, `coverAssetId: string | null`, `totalPages: integer`, `toc: TocEntry[]`, `pages: PageEntry[]`, and `assets: AssetEntry[]`. `TocEntry` is `{ id: string, title: string, pageNumber: integer, order: integer }`. `PageEntry` is `{ pageNumber: integer, imageAssetId: string, textLayerAssetId: string }`. Required arrays are complete and non-null; no published page may omit an image or text layer.
- `AssetEntry` is `{ assetId: string, kind: "COVER" | "PAGE_IMAGE" | "TEXT_LAYER", pageNumber: integer | null, mediaType: string, byteLength: integer, sha256: lowercase-hex-string }`. `pageNumber` is null only for the optional cover asset. Every page's two asset IDs resolve to entries for the same `bookId` and `contentVersion`.
- `GET /api/books/{bookId}/content/{contentVersion}/assets/{assetId}` returns the exact asset bytes with the manifest `mediaType`, `Content-Length`, and `ETag: "sha256-{sha256}"`. The URL is authenticated, version-pinned, and immutable; a missing version/asset returns `404`, incompatible access returns `403`, and bytes never vary within a version.
- Downloads do not call session-dependent reader endpoints, create reading sessions, or record page-view analytics. Clients stage a complete version as not-ready, verify item count/version/length/digest, then publish readiness atomically. A failed replacement retains the previous ready version.

## Annotation anchors and version provenance

- Every positioned book annotation requires `clientEntityId: string`, `contentVersion: integer`, `pageNumber: integer`, and at least one stable text coordinate (`startOffset: integer` and `endOffset: integer`, with `startOffset <= endOffset`). Its server representation additionally requires `id: string` and `revision: integer >= 1`; server-generated IDs are nullable only before first acknowledgement. Unpositioned annotations are not part of this offline contract.
- The server derives owner identity from authentication. Submitted account IDs never establish ownership.
- A mutation with an unavailable or incompatible content version returns a classified conflict; it is never silently remapped to current content.

## Operation envelope and results

- `ReaderOperation` is `{ operationId: UUID, entityId: string | null, bookId: string, contentVersion: integer, baseRevision: integer | null, kind: OperationKind, payload: object }`; `OperationKind` is `PROGRESS_SET | BOOKMARK_ADD | BOOKMARK_REMOVE | ANNOTATION_CREATE | ANNOTATION_UPDATE | ANNOTATION_DELETE`. `operationId` is the idempotency key. There is no account/user ID field; owner identity is the authenticated principal. `entityId` is required for operations targeting an existing entity and null only for first create.
- Retries of an operation ID return its durable prior acknowledgement/result and do not repeat the mutation. Mutation and receipt commit atomically; receipts have no short expiry while the operation can still be replayed.
- Every response has `operationId` and exactly one `result.kind`: `APPLIED { entityId: string, revision: integer, receiptId: string }`, `CONFLICT { entityId: string, serverRevision: integer, serverValue: object, conflictCopyId: string }`, `INCOMPATIBLE_VERSION { requestedContentVersion: integer, supportedContentVersions: integer[] }`, or `ACCESS_DENIED { resourceId: string }`. Conflict preserves both server and offline values; incompatible version and access denied are terminal for that operation until user/account/content state changes. Transport/server failures use HTTP failure and do not acknowledge or discard the queued operation.
- Operations for one entity are ordered. Deletes preserve tombstone/order protection; a delayed create/update cannot resurrect a deleted record.

## Snapshot consistency and tombstones

- `GET /api/books/{bookId}/annotations/snapshot` returns one transactionally consistent per-book view: `{ bookId: string, snapshotRevision: integer, asOf: ISO-8601 timestamp, annotations: Annotation[], tombstones: Tombstone[], conflictCopies: ConflictCopy[] }`. All three collections share the same `snapshotRevision` boundary; `Tombstone` requires `{ entityId: string, deletedAt: ISO-8601 timestamp, revision: integer }`.
- The annotation snapshot excludes reading progress. Progress is fetched and revised independently through `/api/books/{bookId}/progress`; progress is never inferred from annotation snapshot ordering.
- Clients merge by stable entity ID/revision. Pending local operations remain authoritative over older snapshot state, and snapshots do not silently rebase them. Tombstones prevent stale records or retries from resurrecting deleted entities.
- An operation conflict pauses subsequent operations for that entity until explicit resolution.

## Account lifecycle, lock order, and failure classification

- States are `SIGNED_OUT`, `ACTIVE(subject)`, `SYNCING(subject)`, `AUTH_REQUIRED(subject)`, `SIGN_OUT_PENDING(subject)`, and `DEFERRED_LOGOUT(subject)`. Records/outbox are keyed only by immutable `subject`; tokens are never persisted.
- Permitted transitions: `SIGNED_OUT -> ACTIVE` only after successful authentication and no deferred logout barrier; `ACTIVE -> SYNCING` for foreground sync; `SYNCING -> ACTIVE` on completion; `ACTIVE|SYNCING -> AUTH_REQUIRED` on genuine invalid credentials; `AUTH_REQUIRED(subject) -> ACTIVE(the same subject)` only after successful reauthentication; `ACTIVE|SYNCING|AUTH_REQUIRED -> SIGN_OUT_PENDING` after acquiring the lifecycle lock; `SIGN_OUT_PENDING -> ACTIVE` only when a canceled sign-out has not persisted a barrier; `SIGN_OUT_PENDING -> SIGNED_OUT` after drain/discard, durable barrier, cleanup, and completed remote logout; `SIGN_OUT_PENDING -> DEFERRED_LOGOUT` after drain/discard, barrier, cleanup, and unavailable/failed remote logout; `DEFERRED_LOGOUT -> SIGNED_OUT` only after online remote session invalidation completes. Switching subjects uses the same sign-out sequence through `SIGNED_OUT`; only then may the new subject enter `ACTIVE`. No transition activates another subject while a deferred logout exists.
- Cross-tab locks are acquired in strict order: account lifecycle lock, per-account sync lease, per-entity operation lock. Account activation, switching, and sign-out take the lifecycle lock first. Lifecycle work freezes new writes, drains or explicitly discards pending work, persists the barrier, invalidates late sync/auth results, invalidates the remote session or defers logout, clears the old account, then releases the lock.
- Failure discriminants are `TRANSIENT_NETWORK`, `AUTH_REQUIRED`, `SUBJECT_MISMATCH`, `REVISION_CONFLICT`, `CONTENT_VERSION_INCOMPATIBLE`, `ACCESS_DENIED`, and `INVALID_OPERATION`. Network/server failure pauses sync without clearing data; invalid credentials require same-subject reauthentication. The other listed outcomes are not automatically retried/rebased and never trigger cross-account replay.

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
