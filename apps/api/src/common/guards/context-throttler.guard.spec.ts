import type { ExecutionContext } from '@nestjs/common';
import { ContextThrottlerGuard } from './context-throttler.guard.js';

/**
 * Regression coverage for the global throttler's non-HTTP safety.
 *
 * A GraphQL subscription executes in a WebSocket context with no HTTP request.
 * The stock ThrottlerGuard assumes one (`getRequestResponse()` uses
 * `switchToHttp().getRequest()` and `getTracker()` reads `req.ip`), which threw
 * `Cannot read properties of undefined (reading 'ip')` and broke every
 * subscription. These tests pin the skip decision that prevents that.
 */
describe('ContextThrottlerGuard', () => {
  // shouldSkip doesn't touch the injected deps, so empty stand-ins are fine.
  const guard = new ContextThrottlerGuard({} as never, {} as never, {} as never);
  const shouldSkip = (ctx: ExecutionContext): Promise<boolean> =>
    (guard as unknown as { shouldSkip(c: ExecutionContext): Promise<boolean> }).shouldSkip(ctx);

  function httpContext(request: unknown): ExecutionContext {
    return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  }

  it('throttles when an HTTP request is present', async () => {
    await expect(shouldSkip(httpContext({ ip: '127.0.0.1' }))).resolves.toBe(false);
  });

  it('skips when there is no HTTP request (e.g. WS subscription)', async () => {
    await expect(shouldSkip(httpContext(undefined))).resolves.toBe(true);
    await expect(shouldSkip(httpContext(null))).resolves.toBe(true);
  });

  it('skips when the context has no HTTP host at all', async () => {
    const ctx = {
      switchToHttp: () => {
        throw new Error('no HTTP host on this context');
      },
    } as unknown as ExecutionContext;
    await expect(shouldSkip(ctx)).resolves.toBe(true);
  });
});
