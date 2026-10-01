import type { AccountContext } from './account-context';
import type {
  AccountOwner,
  AuthDisplayState,
  AuthFailureClassification,
  BarrierReason,
  DeferredLogoutRecord,
  ExitDecision,
  IdentityVerification,
  InstallOutcome,
  LifecycleBarrierRecord,
  LifecycleStateRecord,
  ReplayIdentity,
  WritePermit,
} from './contracts';

export type {
  AuthFailureClassification,
  ExitDecision,
  IdentityVerification,
  InstallOutcome,
  ReplayIdentity,
  WritePermit,
};

/**
 * Durable lifecycle persistence the lifecycle service needs: the owner/epoch
 * state plus a sign-out/switch barrier and a deferred-logout marker, all of
 * which must survive restart. The IndexedDB adapter implements this against the
 * `lifecycle` store; tests use memory.
 */
export interface LifecyclePersistence {
  readState(): Promise<LifecycleStateRecord | null>;
  writeState(record: LifecycleStateRecord): Promise<void>;
  readBarrier(): Promise<LifecycleBarrierRecord | null>;
  writeBarrier(record: LifecycleBarrierRecord): Promise<void>;
  clearBarrier(): Promise<void>;
  readDeferredLogout(): Promise<DeferredLogoutRecord | null>;
  writeDeferredLogout(record: DeferredLogoutRecord): Promise<void>;
  clearDeferredLogout(): Promise<void>;
}

/**
 * The disjoint controlled-drain report the exit gate consumes. Mirrors
 * `ControlledDrainReport` structurally so the lifecycle does not import the
 * sync coordinator (no cycle). `fullyDrained` is the ONLY success signal — a
 * raw pending count is never used, because it includes blocked successors.
 */
export interface ExitDrainReport {
  readonly fullyDrained: boolean;
  readonly pending: number;
  readonly inFlightOrUncertain: number;
  readonly blockedSuccessors: number;
  readonly conflicts: number;
  readonly terminal: number;
  readonly localOnly: number;
}

/** The seams the exit/drain/logout flow needs (wired by Task 13B). */
export interface LifecycleExitDeps {
  /** The controlled drain contract; `fullyDrained` gates un-synced sign-out. */
  readonly controlledDrain: () => Promise<ExitDrainReport>;
  /**
   * Remote session invalidation. Returns true only when the old session is
   * settled (cookie expired/invalidated); false when offline, failed, or
   * timed out. A timeout alone is NOT proof — callers must settle/abort the
   * outstanding request and report the true settled state here.
   */
  readonly invalidateSession: () => Promise<boolean>;
  /** Destructive local cleanup, run only AFTER the barrier is durable. */
  readonly clearLocalData: (subject: string) => Promise<void>;
  /** Best-effort cross-tab notification of the ownership change. */
  readonly notifyOtherTabs?: () => void;
}

export interface CompleteExitOptions {
  /** Explicit informed discard after the user confirms; skips the drain gate. */
  readonly discard?: boolean;
  /**
   * The caller already observed a fully-drained controlled-drain report in this
   * (frozen) exit; new writes cannot land, so the drain re-check is skipped.
   */
  readonly drained?: boolean;
  readonly reason?: BarrierReason;
}

/**
 * An auth credential/result carrying the lifecycle epoch it originated in.
 * A result computed under an older epoch must never install a token or user.
 */
export interface EpochTaggedResult<T> {
  epoch: number;
  subject: string;
  value: T;
}

/** The verification seam the auth entrypoints call after authenticating. */
export interface AuthLifecycle {
  /** Establishes local ownership from a verified subject, advancing the epoch. */
  establishIdentity(verification: IdentityVerification): Promise<InstallOutcome>;
  /**
   * Installs an epoch-tagged auth result only when subject AND epoch still
   * match the current owner. Returns the outcome; never installs on mismatch.
   */
  installIdentity<T>(result: EpochTaggedResult<T>): Promise<InstallOutcome>;
  /** Durable lifecycle epoch (owner epoch, else stored baseline). */
  epoch(): Promise<number>;
  /**
   * Restores a persisted local owner after a restart. Idempotent; safe to call
   * on every bootstrap. Returns the restored owner (or null).
   */
  hydrate(): Promise<AccountOwner | null>;
  /** Whether private writes are currently authorized. */
  writePermit(): WritePermit;
  /** Whether replay may proceed for the established owner. */
  requireReplayIdentity(): ReplayIdentity;
  /** Display-only auth state; never authorizes a private write. */
  setDisplay(display: AuthDisplayState | null): void;
  /** Marks a genuine auth failure; pauses replay and requires reauth. */
  markAuthRequired(): void;
  /** Records a transient outage; pauses work without clearing local data. */
  markTransient(): void;
  /** Current owner, if any. */
  getOwner(): AccountOwner | null;
  /**
   * Subscribes to lifecycle state changes (ownership, auth-required). Returns an
   * unsubscribe function. Used by React via `useSyncExternalStore` so the
   * download UI reacts to an asynchronous activation instead of reading the
   * permit once per render.
   */
  subscribe(listener: () => void): () => void;
  /** Monotonic snapshot counter for `useSyncExternalStore` getSnapshot. */
  stateVersion(): number;
  /**
   * Task 13B wiring: supplies the controlled drain, remote invalidation, and
   * destructive cleanup seams the exit flow needs.
   */
  configureExitDeps(deps: LifecycleExitDeps): void;
  /**
   * Begins a sign-out / account switch: freezes new writes + replay and reports
   * whether a controlled drain is required before the exit can proceed.
   */
  beginExit(reason?: BarrierReason): ExitDecision;
  /** Cancels a begun-but-uncommitted exit, unfreezing writes + replay. */
  cancelExit(): void;
  /**
   * Resumes an interrupted exit after restart (durable barrier and/or deferred
   * logout with no in-memory state): retries remote invalidation and completes
   * cleanup, or keeps the barrier durable when invalidation still fails.
   */
  resumeExit(): Promise<ExitDecision>;
  /**
   * Completes the exit: gates on the controlled drain (unless `discard`),
   * persists the barrier, invalidates the remote session, and clears old-account
   * data. Returns `SYNC_REQUIRED` when undrained work blocks exit and
   * `BLOCKED/DEFERRED_LOGOUT` when the remote session could not be invalidated.
   */
  completeExit(options?: CompleteExitOptions): Promise<ExitDecision>;
  /** Retries a deferred remote invalidation; unblocks activation on success. */
  resolveDeferredLogout(): Promise<ExitDecision>;
  /** True when no barrier/deferred-logout blocks a new activation. */
  activationEligible(): Promise<boolean>;
}

/**
 * Classifies an auth-dependent failure. Only a genuine 401/UNAUTHENTICATED is
 * `AUTH_REQUIRED`; 5xx and network faults are `TRANSIENT` so callers preserve
 * local content and merely pause auth-dependent work.
 */
export function classifyAuthFailure(status: number): AuthFailureClassification {
  return status === 401 ? 'AUTH_REQUIRED' : 'TRANSIENT';
}

export function classifyAuthError(error: unknown): AuthFailureClassification {
  if (error && typeof error === 'object') {
    const candidate = error as { status?: number; statusCode?: number };
    const status = candidate.status ?? candidate.statusCode;
    if (status === 401) return 'AUTH_REQUIRED';
  }
  return 'TRANSIENT';
}

/**
 * Owns locally-established account ownership and the fencing epoch, separate
 * from display auth state. All identity installation routes through here so a
 * delayed refresh/login result from a previous epoch cannot activate a new
 * subject or overwrite current ownership.
 */
export class AccountLifecycle implements AuthLifecycle {
  private readonly context: AccountContext;
  private readonly persistence: LifecyclePersistence;
  private authRequired = false;
  private freezing = false;
  private exitReason: BarrierReason = 'SIGN_OUT';
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private exitDeps: LifecycleExitDeps;

  constructor(context: AccountContext, persistence: LifecyclePersistence) {
    this.context = context;
    this.persistence = persistence;
    // Fail-closed defaults: with no wired drain/session invalidation an exit
    // cannot be proven complete, so it never silently proceeds.
    this.exitDeps = {
      controlledDrain: async () => ({
        fullyDrained: false,
        pending: 0,
        inFlightOrUncertain: 0,
        blockedSuccessors: 0,
        conflicts: 0,
        terminal: 0,
        localOnly: 0,
      }),
      invalidateSession: async () => false,
      clearLocalData: async () => undefined,
    };
  }

  /** Wires the exit/drain/logout seams (Task 13B). */
  configureExitDeps(deps: LifecycleExitDeps): void {
    this.exitDeps = deps;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  stateVersion(): number {
    return this.version;
  }

  /** Advances the snapshot and notifies subscribers after a state change. */
  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  getOwner(): AccountOwner | null {
    return this.context.getOwner();
  }

  /** Durable lifecycle epoch: owner epoch when owned, else the stored baseline. */
  async epoch(): Promise<number> {
    const owner = this.context.getOwner();
    if (owner) return owner.epoch;
    return this.context.currentEpoch();
  }

  /**
   * Restores the persisted owner into memory. Idempotent: when an owner is
   * already present it is a no-op, so it is safe to call on every bootstrap.
   * This is what makes the different-subject fail-closed guard apply across
   * restarts (a new tab sees the previously established owner).
   */
  async hydrate(): Promise<AccountOwner | null> {
    // A durable barrier or deferred logout means the previous session must not
    // be silently restored: the old account is mid-exit. Automatically RESUME
    // the interrupted exit so a crash cannot leave activation blocked forever
    // (retry invalidation; on success clean up and clear; on failure keep the
    // durable barrier). Fail closed across restart.
    if (await this.persistence.readBarrier()) {
      await this.resumeExit();
      return this.context.getOwner();
    }
    if (await this.persistence.readDeferredLogout()) {
      await this.resumeExit();
      return this.context.getOwner();
    }
    if (this.context.hasEstablishedOwner()) return this.context.getOwner();
    const restored = await this.context.restore();
    if (restored) this.notify();
    return restored;
  }

  setDisplay(display: AuthDisplayState | null): void {
    this.context.setDisplay(display);
  }

  markAuthRequired(): void {
    if (this.authRequired) return;
    this.authRequired = true;
    this.notify();
  }

  /**
   * Records a transient outage. It must NOT un-pause an existing
   * auth-required state or clear local ownership — only a successful
   * same-subject reauthentication resumes replay.
   */
  markTransient(): void {
    // Intentionally preserves `authRequired` and the owner.
  }

  /**
   * Establishes ownership only when the verified subject/epoch are acceptable.
   * A blocked barrier (deferred logout / pending switch) fails closed.
   */
  async establishIdentity(verification: IdentityVerification): Promise<InstallOutcome> {
    // Every activation path (local login/registration, OAuth return, bootstrap,
    // refresh) must pass this gate. A deferred logout blocks activation until
    // the old session is invalidated; a mid-exit barrier blocks until cleanup.
    if (await this.persistence.readDeferredLogout()) {
      return { status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' };
    }
    if (await this.persistence.readBarrier()) {
      return { status: 'BLOCKED', reason: 'REMOTE_INVALIDATION_REQUIRED' };
    }

    const current = this.context.getOwner();
    if (current && current.subject !== verification.subject) {
      // A different subject may only activate after the exit/drain gate;
      // Task 13A fails closed rather than clearing the old account.
      return { status: 'BLOCKED', reason: 'EXIT_NOT_IMPLEMENTED' };
    }

    this.authRequired = false;
    const owner = await this.context.establish(verification.subject);
    this.notify();
    return { status: 'INSTALLED', owner };
  }

  /**
   * Installs an epoch-tagged auth result (refresh/login/OAuth return). Rejected
   * when the origin epoch is stale or the subject differs from the owner, so a
   * delayed response can never fence past a newer lifecycle state.
   */
  async installIdentity<T>(result: EpochTaggedResult<T>): Promise<InstallOutcome> {
    // A pending exit (barrier/deferred logout) blocks EVERY activation path,
    // including a delayed epoch-tagged refresh/login result.
    if (await this.persistence.readDeferredLogout()) {
      return { status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' };
    }
    if (await this.persistence.readBarrier()) {
      return { status: 'BLOCKED', reason: 'REMOTE_INVALIDATION_REQUIRED' };
    }
    const owner = this.context.getOwner();
    const epoch = await this.context.currentEpoch();
    if (result.epoch !== epoch) {
      return owner
        ? { status: 'STALE_EPOCH', current: owner }
        : { status: 'BLOCKED', reason: 'REMOTE_INVALIDATION_REQUIRED' };
    }
    if (owner && owner.subject !== result.subject) {
      return { status: 'SUBJECT_MISMATCH', expected: owner.subject, received: result.subject };
    }
    return this.establishIdentity({ subject: result.subject, epoch: result.epoch });
  }

  writePermit(): WritePermit {
    // Freeze new writes while exiting (draining) so no edit lands during the
    // commit window between the drain decision and the durable barrier.
    if (this.freezing) return { permitted: false, reason: 'BLOCKED' };
    const owner = this.context.getOwner();
    if (this.authRequired) return { permitted: false, reason: 'AUTH_REQUIRED' };
    if (!owner) return { permitted: false, reason: 'NO_OWNER' };
    return { permitted: true, owner };
  }

  requireReplayIdentity(): ReplayIdentity {
    if (this.freezing) return { status: 'PAUSED', reason: 'BLOCKED' };
    const owner = this.context.getOwner();
    if (this.authRequired) return { status: 'PAUSED', reason: 'AUTH_REQUIRED' };
    if (!owner) return { status: 'PAUSED', reason: 'NO_OWNER' };
    return { status: 'READY', owner };
  }

  /**
   * Begins the exit: freezes new writes + replay and reports that a controlled
   * drain is required. The caller then runs `completeExit()` (drained) or
   * confirms an explicit discard.
   */
  beginExit(reason: BarrierReason = 'SIGN_OUT'): ExitDecision {
    if (this.freezing) return { status: 'SYNC_REQUIRED', reason: 'PENDING_WORK' };
    const owner = this.context.getOwner();
    if (!owner) return { status: 'PROCEED' };
    this.exitReason = reason;
    this.freezing = true;
    this.notify();
    return { status: 'SYNC_REQUIRED', reason: 'PENDING_WORK' };
  }

  /**
   * Cancels a begun-but-uncommitted exit, unfreezing writes + replay. Once the
   * exit has committed (ownership cleared / barrier durable) `freezing` is
   * already false, so this is a safe no-op then.
   */
  cancelExit(): void {
    if (!this.freezing) return;
    this.freezing = false;
    this.notify();
  }

  /**
   * Resumes an interrupted exit after restart. When only a durable barrier
   * remains (a crash mid-exit), it retries remote invalidation and, on success,
   * runs destructive cleanup BEFORE clearing the barrier; on failure it keeps
   * the barrier (writing a deferred marker) so activation stays blocked. With
   * no barrier/deferred it is a no-op.
   */
  async resumeExit(): Promise<ExitDecision> {
    const barrier = await this.persistence.readBarrier();
    const deferred = await this.persistence.readDeferredLogout();
    if (!barrier && !deferred) return { status: 'PROCEED' };
    const subject = (deferred ?? barrier)?.subject ?? '';
    const epoch = (deferred ?? barrier)?.epoch ?? 0;

    let settled = false;
    try {
      settled = await this.exitDeps.invalidateSession();
    } catch {
      settled = false;
    }
    if (!settled) {
      if (!deferred) {
        await this.persistence.writeDeferredLogout({
          id: 'deferred-logout',
          subject,
          epoch,
          createdAt: Date.now(),
        });
      }
      return { status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' };
    }
    // Invalidation settled: clean up the old subject BEFORE clearing the barrier
    // so activation never becomes eligible while old data is still live.
    try {
      await this.exitDeps.clearLocalData(subject);
    } catch {
      // Cleanup is best effort; the barrier remains until it is cleared below.
    }
    await this.persistence.clearDeferredLogout();
    await this.persistence.clearBarrier();
    this.notify();
    return { status: 'PROCEED' };
  }

  /**
   * Completes sign-out / account switch. Order is load-bearing:
   *  1. gate on the controlled drain (unless an explicit informed discard),
   *  2. persist the durable barrier BEFORE any destructive step,
   *  3. clear local ownership (advancing the epoch, fencing late results) and
   *     notify other tabs,
   *  4. invalidate the remote session; on failure persist a deferred-logout
   *     marker that blocks all activation,
   *  5. clear old-account data (only after the barrier is durable).
   */
  async completeExit(options: CompleteExitOptions = {}): Promise<ExitDecision> {
    const owner = this.context.getOwner();
    this.freezing = true;
    if (!owner) {
      this.freezing = false;
      // A pending deferred logout means the old session is still live: keep it
      // (and the barrier) so activation stays blocked; otherwise clear a stale
      // barrier so a crash-leftover gate does not block forever.
      if (await this.persistence.readDeferredLogout()) {
        return { status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' };
      }
      await this.persistence.clearBarrier();
      return { status: 'PROCEED' };
    }

    if (options.discard !== true && options.drained !== true) {
      // Un-synced sign-out MUST be gated on the disjoint controlled-drain
      // contract, never a raw pending count (which includes blocked successors).
      const report = await this.exitDeps.controlledDrain();
      if (!report.fullyDrained) {
        return { status: 'SYNC_REQUIRED', reason: 'PENDING_WORK' };
      }
    }

    // 2. Persist the durable barrier BEFORE any destructive step.
    await this.persistBarrier(owner.subject, owner.epoch, options.reason ?? this.exitReason);
    // 3. Clear local ownership (advances the epoch, fencing every late result).
    await this.context.clear();
    this.authRequired = false;
    this.freezing = false;
    this.notify();

    // 4. Invalidate the remote session; a timeout/failure is NOT proof the old
    //    cookie is gone.
    let settled = false;
    try {
      settled = await this.exitDeps.invalidateSession();
    } catch {
      settled = false;
    }

    // 5. Destructive local cleanup runs BEFORE the barrier is cleared, so
    //    activation can never become eligible while old-subject data (Apollo
    //    cache, in-memory auth, IndexedDB) is still live.
    try {
      await this.exitDeps.clearLocalData(owner.subject);
    } catch {
      // Cleanup is best effort; the barrier stays durable until cleared below.
    }

    if (settled) {
      await this.persistence.clearBarrier();
      await this.persistence.clearDeferredLogout();
    } else {
      // Keep the barrier AND persist a deferred marker; activation stays blocked
      // until invalidation completes.
      await this.persistence.writeDeferredLogout({
        id: 'deferred-logout',
        subject: owner.subject,
        epoch: owner.epoch,
        createdAt: Date.now(),
      });
    }
    this.exitDeps.notifyOtherTabs?.();

    return settled ? { status: 'PROCEED' } : { status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' };
  }

  /**
   * Retries a deferred remote invalidation. On success the deferred marker and
   * barrier are cleared, unblocking activation; on failure it stays blocked.
   */
  async resolveDeferredLogout(): Promise<ExitDecision> {
    const deferred = await this.persistence.readDeferredLogout();
    if (!deferred) {
      await this.persistence.clearBarrier();
      return { status: 'PROCEED' };
    }
    let settled = false;
    try {
      settled = await this.exitDeps.invalidateSession();
    } catch {
      settled = false;
    }
    if (!settled) return { status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' };
    await this.persistence.clearDeferredLogout();
    await this.persistence.clearBarrier();
    this.notify();
    return { status: 'PROCEED' };
  }

  /** True when no durable barrier or deferred logout blocks a new activation. */
  async activationEligible(): Promise<boolean> {
    if (await this.persistence.readDeferredLogout()) return false;
    if (await this.persistence.readBarrier()) return false;
    return true;
  }

  /** Persists a durable barrier that must survive restart. */
  async persistBarrier(subject: string, epoch: number, reason: 'SIGN_OUT' | 'ACCOUNT_SWITCH'): Promise<void> {
    await this.persistence.writeBarrier({
      id: 'lifecycle-barrier',
      subject,
      epoch,
      reason,
      createdAt: Date.now(),
    });
  }

  barrier(): Promise<LifecycleBarrierRecord | null> {
    return this.persistence.readBarrier();
  }
}
