import { Module } from '@nestjs/common';
import { ChatService } from './chat.service.js';
import { ChatResolver } from './chat.resolver.js';
import { PubSubService } from './pubsub.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  providers: [ChatService, ChatResolver, PubSubService],
  exports: [ChatService, PubSubService],
})
export class ChatModule {}
