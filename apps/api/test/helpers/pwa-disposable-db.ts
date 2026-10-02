import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';

export async function startOwnedDisposableDatabase(ownerId: string = randomUUID()): Promise<StartedPostgreSqlContainer> {
  const container = await new PostgreSqlContainer('postgres:15-alpine')
    .withDatabase('testdb')
    .withUsername('test')
    .withPassword('test')
    .withLabels({ 'transformlit.owner': ownerId })
    .start();
  return container;
}

export function assertOwnedDisposableDatabaseUrl(
  databaseUrl: string | undefined,
  container?: StartedPostgreSqlContainer | null,
): asserts databaseUrl is string {
  if (databaseUrl === undefined || container === undefined || container === null || container.getConnectionUri() !== databaseUrl) {
    throw new Error('Refusing database reset: URL is not owned by a live disposable Testcontainers instance');
  }
}
