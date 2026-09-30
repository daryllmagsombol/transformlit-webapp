import { startOwnedDisposableDatabase, assertOwnedDisposableDatabaseUrl } from '../helpers/pwa-disposable-db.js';

export { assertOwnedDisposableDatabaseUrl };
export function assertTask1AOwnedDatabaseUrl(
  databaseUrl: string | undefined,
  container: import('@testcontainers/postgresql').StartedPostgreSqlContainer | null | undefined,
): string {
  assertOwnedDisposableDatabaseUrl(databaseUrl, container);
  return databaseUrl;
}
export async function provisionOwnedDatabase(ownerId: string) {
  const container = await startOwnedDisposableDatabase(ownerId);
  assertTask1AOwnedDatabaseUrl(container.getConnectionUri(), container);
  return { container, databaseUrl: container.getConnectionUri(), containerId: container.getId() };
}
