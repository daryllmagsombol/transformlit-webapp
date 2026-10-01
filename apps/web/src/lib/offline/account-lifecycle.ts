import type { AccountContext } from './account-context';
import type {
  AccountOwner,
  AuthDisplayState,
  AuthFailureClassification,
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
 * state plus a sign-out/switch barrier that must survive restart. The IndexedDB
 * adapter implements this against the `lifecycle` store; tests use memory.
 */
export interface LifecyclePersistence {
  readState(): Promise<LifecycleStateRecord | null>;
  writeState(record: LifecycleStateRecord): Promise<void>;
  readBarrier(): Promise<LifecycleBarrierRecord | null>;
  writeBarrier(record: LifecycleBarrierRecord): Promise<void>;
  clearBarrier(): Promise<void>;
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
  /** Task 13B seam: fail-closed, never clears data in Task 13A. */
  beginExit(): ExitDecision;
  /** Task 13B seam: not implemented here; always fails closed. */
  completeExit(): Promise<ExitDecision>;
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
    const status =
      'status' in error
        ? (error as { status?: number }).status
        : 'statusCode' in error
          ? (error as { statusCode?: number }).statusCode
          : undefined;
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

  constructor(context: AccountContext, persistence: LifecyclePersistence) {
    this.context = context;
    this.persistence = persistence;
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

  setDisplay(display: AuthDisplayState | null): void {
    this.context.setDisplay(display);
  }

  markAuthRequired(): void {
    this.authRequired = true;
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
    const barrier = await this.persistence.readBarrier();
    if (barrier) {
      return { status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' };
    }

    const current = this.context.getOwner();
    if (current && current.subject !== verification.subject) {
      // A different subject may only activate after the exit/drain gate;
      // Task 13A fails closed rather than clearing the old account.
      return { status: 'BLOCKED', reason: 'EXIT_NOT_IMPLEMENTED' };
    }

    this.authRequired = false;
    const owner = await this.context.establish(verification.subject);
    return { status: 'INSTALLED', owner };
  }

  /**
   * Installs an epoch-tagged auth result (refresh/login/OAuth return). Rejected
   * when the origin epoch is stale or the subject differs from the owner, so a
   * delayed response can never fence past a newer lifecycle state.
   */
  async installIdentity<T>(result: EpochTaggedResult<T>): Promise<InstallOutcome> {
    const owner = this.context.getOwner();
    const epoch = await this.context.currentEpoch();
    if (result.epoch !== epoch) {
      return owner
        ? { status: 'STALE_EPOCH', current: owner }
        : { status: 'BLOCKED', reason: 'EXIT_NOT_IMPLEMENTED' };
    }
    if (owner && owner.subject !== result.subject) {
      return { status: 'SUBJECT_MISMATCH', expected: owner.subject, received: result.subject };
    }
    return this.establishIdentity({ subject: result.subject, epoch: result.epoch });
  }

  writePermit(): WritePermit {
    const owner = this.context.getOwner();
    if (this.authRequired) return { permitted: false, reason: 'AUTH_REQUIRED' };
    if (!owner) return { permitted: false, reason: 'NO_OWNER' };
    return { permitted: true, owner };
  }

  requireReplayIdentity(): ReplayIdentity {
    const owner = this.context.getOwner();
    if (this.authRequired) return { status: 'PAUSED', reason: 'AUTH_REQUIRED' };
    if (!owner) return { status: 'PAUSED', reason: 'NO_OWNER' };
    return { status: 'READY', owner };
  }

  /**
   * Task 13A only scaffolds exit: it never clears data or switches subjects.
   * A durable barrier or any established owner makes exit fail closed.
   */
  beginExit(): ExitDecision {
    if (this.context.getOwner()) {
      return { status: 'BLOCKED', reason: 'EXIT_NOT_IMPLEMENTED' };
    }
    return { status: 'PROCEED' };
  }

  async completeExit(): Promise<ExitDecision> {
    // Exit/drain/logout is Task 13B. Task 13A deliberately refuses to clear
    // data or invalidate sessions here.
    return { status: 'BLOCKED', reason: 'EXIT_NOT_IMPLEMENTED' };
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
