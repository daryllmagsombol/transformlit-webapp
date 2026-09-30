import { startOwnedDisposableDatabase, assertOwnedDisposableDatabaseUrl } from '../helpers/pwa-disposable-db.js';

export { assertOwnedDisposableDatabaseUrl };
export async function provisionOwnedDatabase() {
  const container = await startOwnedDisposableDatabase();
  return { container, databaseUrl: container.getConnectionUri(), containerId: container.getId() };
}
