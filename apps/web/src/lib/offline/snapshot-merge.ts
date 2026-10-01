import type { ConflictCopyRecord } from './contracts';

/**
 * Transport-agnostic view of one annotation for merge purposes. `data` carries
 * the kind-specific payload (page/text/note/anchor/label/color/contentVersion)
 * without this module needing every field.
 */
export interface MergeAnnotation {
  /** Stable server entity id, or the local provisional id before sync. */
  readonly id: string;
  readonly kind: 'BOOKMARK' | 'ANNOTATION';
  readonly clientEntityId: string | null;
  readonly revision: number;
  readonly deletedAt: number | null;
  readonly data: Readonly<Record<string, unknown>>;
}

/** A server- or locally-recorded deletion identity. */
export interface MergeTombstone {
  readonly entityId: string;
  readonly kind: 'BOOKMARK' | 'ANNOTATION';
  readonly revision: number;
  readonly deletedAt: number;
}

/** A queued local operation. `payload`/`baseRevision` are never mutated here. */
export interface MergePendingOperation {
  readonly operationId: string;
  readonly kind:
    | 'PROGRESS_SET'
    | 'BOOKMARK_ADD'
    | 'BOOKMARK_REMOVE'
    | 'ANNOTATION_CREATE'
    | 'ANNOTATION_UPDATE'
    | 'ANNOTATION_DELETE';
  readonly entityId: string | null;
  readonly clientEntityId: string | null;
  readonly baseRevision: number | null;
  readonly payload: unknown;
}

export interface AuthoritativeSnapshot {
  readonly bookId: string;
  readonly snapshotRevision: number;
  readonly annotations: readonly MergeAnnotation[];
  readonly tombstones: readonly MergeTombstone[];
  readonly conflictCopies: readonly ConflictCopyRecord[];
}

export interface MergeSnapshotInput {
  readonly snapshot: AuthoritativeSnapshot;
  readonly local: readonly MergeAnnotation[];
  readonly pending: readonly MergePendingOperation[];
}

export interface MergeSnapshotResult {
  readonly annotations: MergeAnnotation[];
  /** Server deletions retained as tombstones (plus local delete intents). */
  readonly tombstones: MergeTombstone[];
  readonly conflictCopies: ConflictCopyRecord[];
  /** Pending operations returned unchanged; never rebased by the snapshot. */
  readonly pending: MergePendingOperation[];
}

/** True when a queued operation targets this specific annotation identity. */
function pendingTargets(pending: MergePendingOperation, annotation: MergeAnnotation): boolean {
  if (pending.clientEntityId !== null && pending.clientEntityId === annotation.clientEntityId) return true;
  return pending.entityId !== null && pending.entityId === annotation.id;
}

/** True when a queued operation targets this tombstoned entity id. */
function pendingTargetsEntity(pending: MergePendingOperation, entityId: string): boolean {
  return pending.entityId !== null && pending.entityId === entityId;
}

function annotationKey(annotation: MergeAnnotation): string {
  return annotation.clientEntityId === null
    ? `entity:${annotation.id}`
    : `client:${annotation.clientEntityId}`;
}

function tombstoneKey(tombstone: MergeTombstone): string {
  return `entity:${tombstone.entityId}`;
}

/**
 * Merges an authoritative annotation snapshot with local records and pending
 * operations.
 *
 * Guarantees (see docs/superpowers/specs/2026-10-01-pwa-contracts.md):
 * - Merge is by stable entity ID (`clientEntityId` when present, else `id`).
 * - A pending local create/update/delete is authoritative for its entity: an
 *   older snapshot value or a server tombstone never overrides it, and the
 *   pending operation's `baseRevision`/`payload` are returned unmodified.
 * - Snapshots never rebase unresolved pending operations.
 * - Server deletions are retained as tombstones; a tombstone removes a matching
 *   local record only when no pending operation still targets that entity.
 * - Conflict copies merge by id, keeping the server's current revision.
 * - Progress is not part of the snapshot and is never merged here.
 */
export function mergeSnapshot(input: MergeSnapshotInput): MergeSnapshotResult {
  const pending = [...input.pending];
  const pendingFor = (annotation: MergeAnnotation) => pending.some((operation) => pendingTargets(operation, annotation));
  const pendingForEntity = (entityId: string) => pending.some((operation) => pendingTargetsEntity(operation, entityId));

  const snapshotByKey = new Map<string, MergeAnnotation>();
  for (const annotation of input.snapshot.annotations) snapshotByKey.set(annotationKey(annotation), annotation);

  const tombstoneByEntity = new Map<string, MergeTombstone>();
  for (const tombstone of input.snapshot.tombstones) tombstoneByEntity.set(tombstone.entityId, tombstone);

  const merged = new Map<string, MergeAnnotation>();
  const tombstones = new Map<string, MergeTombstone>();

  // Retain every server tombstone as authoritative deletion history.
  for (const tombstone of input.snapshot.tombstones) tombstones.set(tombstoneKey(tombstone), tombstone);

  // Snapshot annotations seed the result, but a local record touched by a
  // pending op replaces the server value (pending stays authoritative).
  for (const annotation of input.snapshot.annotations) {
    merged.set(annotationKey(annotation), annotation);
  }

  for (const local of input.local) {
    const key = annotationKey(local);
    const hasPending = pendingFor(local);
    const server = snapshotByKey.get(key);
    const tombstone = tombstoneByEntity.get(local.id);

    if (hasPending) {
      // Pending local work wins outright; never rebased by the snapshot.
      merged.set(key, local);
      // A local delete still proves the entity is deleted on this device.
      if (local.deletedAt !== null) {
        tombstones.set(`entity:${local.id}`, {
          entityId: local.id,
          kind: local.kind,
          revision: local.revision,
          deletedAt: local.deletedAt,
        });
      }
      continue;
    }

    if (tombstone) {
      // Server deletion without pending local work: drop the local present copy,
      // keep the tombstone so a delayed retry cannot resurrect it.
      merged.delete(key);
      tombstones.set(tombstoneKey(tombstone), tombstone);
      continue;
    }

    if (server && server.revision >= local.revision) {
      merged.set(key, server);
      continue;
    }

    // Locally known but absent/stale on the server and not deleted: keep it so a
    // partial snapshot is never treated as authoritative absence.
    merged.set(key, local);
  }

  const conflictCopies = [...input.snapshot.conflictCopies]
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    annotations: [...merged.values()].sort((a, b) => annotationKey(a).localeCompare(annotationKey(b))),
    tombstones: [...tombstones.values()].sort((a, b) => tombstoneKey(a).localeCompare(tombstoneKey(b))),
    conflictCopies,
    pending,
  };
}

/**
 * True only when `snapshotRevision` — a MAX-REVISION WATERMARK, not a monotonic
 * change sequence — has advanced past `lastAppliedRevision`.
 *
 * This is a WEAK hint, not a change detector. A snapshot can contain a genuinely
 * new or updated entity at an equal-or-lower revision than a previously applied
 * one (e.g. a new entity starting at revision 1 while the watermark is already
 * 3), so a `false` result does NOT prove the snapshot is unchanged. Callers MUST
 * always run the per-entity `mergeSnapshot`; never skip a merge because this
 * returns false. It is named `snapshotWatermarkAdvanced` to make that explicit.
 */
export function snapshotWatermarkAdvanced(
  snapshot: AuthoritativeSnapshot,
  lastAppliedRevision: number,
): boolean {
  return snapshot.snapshotRevision > lastAppliedRevision;
}

/** A present (non-deleted) annotation, for consumers that only render live rows. */
export function presentAnnotations(annotations: readonly MergeAnnotation[]): MergeAnnotation[] {
  return annotations.filter((annotation) => annotation.deletedAt === null);
}
