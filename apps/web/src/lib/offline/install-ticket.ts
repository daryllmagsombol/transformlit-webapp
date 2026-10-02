/**
 * Lifecycle-owned install-ticket authority.
 *
 * A ticket is a one-shot, brand-checked proof that a caller passed through the
 * account-lifecycle gate for a verified subject + epoch. The auth store only
 * installs a token/user when presented with a valid ticket.
 *
 * This module is deliberately NOT re-exported from the public `lib` barrel:
 * only the account-lifecycle gate (and its tests) can produce a ticket, so "no
 * component may bypass the gate" is a structural property rather than a
 * convention.
 */

export interface AuthInstallTicket {
  readonly subject: string;
  readonly epoch: number;
}

const validInstallTickets = new WeakSet<object>();

/** Mints a ticket for a verified subject/epoch. Only the lifecycle gate calls this. */
export function issueAuthInstallTicket(subject: string, epoch: number): AuthInstallTicket {
  const ticket: AuthInstallTicket = { subject, epoch };
  validInstallTickets.add(ticket);
  return ticket;
}

export function isAuthInstallTicket(value: unknown): value is AuthInstallTicket {
  return typeof value === 'object' && value !== null && validInstallTickets.has(value);
}
