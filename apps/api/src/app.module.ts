import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';
import { join } from 'node:path';
import type { Request } from 'express';
import type { ValidationContext } from 'graphql';
import depthLimit from 'graphql-depth-limit';

import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { GroupsModule } from './groups/groups.module.js';
import { FriendsModule } from './friends/friends.module.js';
import { ChatModule } from './chat/chat.module.js';
import { BooksModule } from './books/books.module.js';
import { FeedModule } from './feed/feed.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AzureModule } from './azure/azure.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { HealthModule } from './health/health.module.js';

/**
 * NestJS's built-in GraphQLISODateTime.serialize returns null unless the value
 * is a Date instance. Subscription payloads are published via Postgres NOTIFY
 * (JSON.stringify -> pg_notify -> JSON.parse), which turns every Date into an
 * ISO string — so messageAdded/notificationReceived always failed to serialize
 * their createdAt fields. Accept both Date objects and valid ISO strings, and
 * throw (never return null / Invalid Date) on anything that cannot be
 * represented as a DateTime.
 */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? Object.prototype.toString.call(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

export const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description:
    'A date-time string at UTC, such as 2019-12-03T09:54:33Z, compliant with the date-time format.',
  parseValue(value: unknown) {
    if (typeof value !== 'string') {
      throw new GraphQLError(`DateTime cannot represent a non-string value: ${describeValue(value)}`);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new GraphQLError(`DateTime cannot represent an invalid date: ${value}`);
    }
    return d;
  },
  serialize(value: unknown) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    throw new GraphQLError(`DateTime cannot represent value: ${describeValue(value)}`);
  },
  parseLiteral(ast) {
    if (ast.kind !== Kind.STRING || typeof ast.value !== 'string') {
      throw new GraphQLError('DateTime cannot represent a non-string literal');
    }
    const d = new Date(ast.value);
    if (Number.isNaN(d.getTime())) {
      throw new GraphQLError(`DateTime cannot represent an invalid date: ${ast.value}`);
    }
    return d;
  },
});

/**
 * Query-depth protection via `graphql-depth-limit` (max 10 levels of nesting).
 * NOTE: a query-complexity rule (graphql-query-complexity@2 `createComplexityRule`)
 * was previously added here but REMOVED because it breaks every GraphQL
 * operation that uses variables — its validation-time argument coercion runs
 * without the runtime variables and fails with "Variable ... was not provided".
 * Depth limiting still guards against runaway nested/aliased queries with no
 * dependency on variable values.
 */
function createQueryCostValidationRules(): ((context: ValidationContext) => unknown)[] {
  return [depthLimit(10)];
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(__dirname, 'schema.gql'),
      sortSchema: true,
      introspection: process.env.NODE_ENV !== 'production',
      // BISECT: depthLimit only
      validationRules: [depthLimit(10)],
      buildSchemaOptions: {
        scalarsMap: [{ type: Date, scalar: DateTimeScalar }],
      },
      subscriptions: {
        'graphql-ws': {
          path: '/graphql',
        },
      },
      context: ({ req, extra, connectionParams }: any) => {
        // HTTP request
        if (req) return { req };
        // WebSocket connection — check connectionParams
        const params = connectionParams || extra?.connectionParams || {};
        const authHeader = params.Authorization || params.authorization || '';
        return {
          req: {
            headers: {
              authorization: authHeader,
            },
          },
        };
      },
    }),

    PrismaModule,
    AzureModule,
    UploadsModule,
    AuthModule,
    UsersModule,
    GroupsModule,
    FriendsModule,
    ChatModule,
    BooksModule,
    FeedModule,
    NotificationsModule,
    HealthModule,
  ],
})
export class AppModule {}
