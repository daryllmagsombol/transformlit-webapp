export { apolloClient } from './apollo-client';
// NOTE: `setAccessToken` is intentionally NOT re-exported. Installing a token
// must go through the account-lifecycle gate (`installAuth` with a lifecycle
// ticket); exposing a raw token setter would let any component bypass it.
export {
  getAccessToken,
  removeAccessToken,
  clearAuth,
  isTokenExpiringSoon,
} from './auth';
export { useRequireAuth } from './hooks/use-require-auth';
