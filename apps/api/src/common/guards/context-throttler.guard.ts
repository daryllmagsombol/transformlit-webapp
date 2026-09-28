import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Global throttler that is safe for non-HTTP execution contexts.
 *
 * The stock `ThrottlerGuard` assumes an HTTP request: `handleRequest` calls
 * `context.switchToHttp().getRequest()` and `getTracker` reads `req.ip`, and it
 * then writes headers via `res.header(...)`. GraphQL **subscriptions** execute in
 * a WebSocket context where there is no HTTP request, so the stock guard throws
 * `TypeError: Cannot read properties of undefined (reading 'ip')` and every
 * subscription fails.
 *
 * We keep rate limiting for HTTP requests (REST routes and GraphQL
 * queries/mutations) and skip contexts that have no HTTP request — i.e. WS
 * subscriptions. Subscription volume is bounded by the socket connection rather
 * than by an HTTP request budget, so skipping is the correct behavior here and
 * is NOT a security gap for HTTP endpoints.
 */
@Injectable()
export class ContextThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    let request: unknown;
    try {
      request = context.switchToHttp().getRequest();
    } catch {
      // No HTTP host on this context (e.g. WS subscription) → not throttleable.
      return true;
    }
    return request === undefined || request === null;
  }
}
