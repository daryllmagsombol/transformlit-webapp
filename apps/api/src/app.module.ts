import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLScalarType, Kind } from 'graphql';
import { join } from 'node:path';
import type { Request } from 'express';

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
 * their createdAt fields. Accept both Date objects and valid ISO strings.
 */
const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description:
    'A date-time string at UTC, such as 2019-12-03T09:54:33Z, compliant with the date-time format.',
  parseValue(value: unknown) {
    return new Date(value as string);
  },
  serialize(value: unknown) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return null;
  },
  parseLiteral(ast) {
    return ast.kind === Kind.STRING ? new Date(ast.value) : null;
  },
});

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(__dirname, 'schema.gql'),
      sortSchema: true,
      introspection: true,
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
