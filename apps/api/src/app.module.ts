import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
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
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(__dirname, 'schema.gql'),
      sortSchema: true,
      introspection: true,
      subscriptions: {
        'graphql-ws': {
          path: '/graphql',
        },
      },
      context: ({ req, extra }: any) => {
        // HTTP request
        if (req) return { req };
        // WebSocket connection — check connectionParams
        if (extra) {
          const connectionParams = extra.connectionParams || {};
          const authHeader =
            connectionParams.Authorization ||
            connectionParams.authorization ||
            '';
          return {
            req: {
              headers: {
                authorization: authHeader,
              },
            },
          };
        }
        return { req };
      },
    }),

    PrismaModule,
    AzureModule,
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
