import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PubSubService } from '../src/chat/pubsub.service.js';
import { AppModule } from '../src/app.module.js';
import { assertCanonicalSchemaMatches, deterministicSchemaBytes } from './helpers/schema-drift.js';

async function main(): Promise<void> {
  process.env.JWT_SECRET ??= 'compiled-schema-probe-secret';
  const canonicalPath = resolve('src/schema.gql');
  const canonicalBefore = readFileSync(canonicalPath);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(PubSubService)
    .useValue({ onModuleInit: async () => undefined, onModuleDestroy: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication();
  try {
    await app.init();
    assertCanonicalSchemaMatches(
      deterministicSchemaBytes(app.get(GraphQLSchemaHost).schema),
      canonicalBefore,
    );
    if (!readFileSync(canonicalPath).equals(canonicalBefore)) {
      throw new Error('Ordinary AppModule bootstrap mutated the tracked canonical SDL');
    }
    process.stdout.write('Compiled AppModule bootstrap matches canonical SDL without mutation.\n');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
