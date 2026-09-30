import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { PubSubService } from '../../src/chat/pubsub.service.js';
import { AppModule } from '../../src/app.module.js';

describe('DB-free GraphQL AppModule bootstrap', () => {
  it('creates deterministic in-memory schema and leaves tracked SDL unchanged', async () => {
    process.env.JWT_SECRET ??= 'db-free-schema-test-secret';
    const canonicalPath = resolve(__dirname, '../../src/schema.gql');
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
      expect(app.get(GraphQLSchemaHost).schema.getQueryType()).toBeDefined();
      expect(readFileSync(canonicalPath)).toEqual(canonicalBefore);
    } finally {
      await app.close();
    }
  });
});
