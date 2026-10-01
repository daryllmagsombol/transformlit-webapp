import {
  type AccountOwner,
  type AuthDisplayState,
  type LifecycleStateRecord,
  StaleEpochError,
  SubjectMismatchError,
} from './contracts';

/**
 * Durable lifecycle state. The IndexedDB adapter reads/writes the singleton
 * `lifecycle` record; tests use an in-memory implementation.
 */
export interface LifecyclePersistence {
  readState(): Promise<LifecycleStateRecord | null>;
  writeState(record: LifecycleStateRecord): Promise<void>;
}

/**
 * Fails closed unless the caller's subject matches the established owner and
 * its epoch is current. A private write must pass this check before it may be
 * committed, so a late result from a previous account or epoch cannot leak.
 */
export function assertWriteEligibility(
  owner: AccountOwner | null,
  subject: string,
  epoch: number,
): void {
  if (owner === null || owner.subject !== subject) {
    throw new SubjectMismatchError(
      `Refusing write for subject ${subject}; owner is ${owner?.subject ?? 'none'}`,
    );
  }
  if (owner.epoch !== epoch) {
    // `assertWriteEligibility` must always throw in this branch; the explicit
    // throw keeps the function total when a caller passes a matching epoch.
    throw new StaleEpochError(`Refusing write for epoch ${epoch}; current epoch is ${owner.epoch}`);
  }
}

/**
 * Locally established account ownership, separate from display-only auth
 * state. The owner is the only thing that authorizes private reads/writes; it
 * carries an immutable subject plus a lifecycle epoch that advances on every
 * owner change so stale in-flight writes are fenced.
 */
export class AccountContext {
  private owner: AccountOwner | null = null;
  private display: AuthDisplayState | null = null;
  private readonly persistence: LifecyclePersistence;

  constructor(persistence: LifecyclePersistence) {
    this.persistence = persistence;
  }

  getOwner(): AccountOwner | null {
    return this.owner;
  }

  getDisplay(): AuthDisplayState | null {
    return this.display;
  }

  /** True once a verified subject owns this browser profile. */
  hasEstablishedOwner(): boolean {
    return this.owner !== null;
  }

  /** Current lifecycle epoch, or 0 before any owner was ever established. */
  async currentEpoch(): Promise<number> {
    const record = await this.persistence.readState();
    return record?.epoch ?? 0;
  }

  /** Display identity only. Does not establish ownership or authorize writes. */
  setDisplay(display: AuthDisplayState | null): void {
    this.display = display;
  }

  async restore(): Promise<AccountOwner | null> {
    const record = await this.persistence.readState();
    if (record?.subject) {
      this.owner = { subject: record.subject, epoch: record.epoch };
    }
    return this.owner;
  }

  /**
   * Establishes ownership for `subject`. Re-establishing the same subject is
   * idempotent; a different subject (or a cleared owner) advances the epoch so
   * every operation fenced to the old epoch is rejected.
   */
  async establish(subject: string): Promise<AccountOwner> {
    const record = await this.persistence.readState();
    const sameOwner = record?.subject === subject;
    const epoch = sameOwner ? record.epoch : (record?.epoch ?? 0) + 1;
    const next: LifecycleStateRecord = {
      id: 'lifecycle',
      state: 'ACTIVE',
      subject,
      epoch,
      updatedAt: Date.now(),
    };
    await this.persistence.writeState(next);
    this.owner = { subject, epoch };
    return this.owner;
  }

  /** Clears local ownership while fencing the previous epoch permanently. */
  async clear(): Promise<void> {
    const record = await this.persistence.readState();
    const next: LifecycleStateRecord = {
      id: 'lifecycle',
      state: 'SIGNED_OUT',
      subject: null,
      epoch: (record?.epoch ?? 0) + 1,
      updatedAt: Date.now(),
    };
    await this.persistence.writeState(next);
    this.owner = null;
  }
}
