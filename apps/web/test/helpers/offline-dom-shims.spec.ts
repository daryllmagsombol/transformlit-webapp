/**
 * Guards I4: the jsdom capability shims for `Response`/Text encoding must be
 * OPT-IN per spec, not installed globally from `jest.setup.ts`. If they leak
 * globally, `globalThis.Response`/`TextEncoder` are replaced for every suite
 * and `instanceof Blob`/`File` behavior in unrelated UI tests can change.
 *
 * This spec deliberately does NOT import the shims.
 */
describe('offline DOM shims are scoped', () => {
  it('does not replace TextEncoder/TextDecoder/Response globally', () => {
    expect(globalThis.TextEncoder).toBeUndefined();
    expect(globalThis.TextDecoder).toBeUndefined();
    expect(globalThis.Response).toBeUndefined();
  });
});
