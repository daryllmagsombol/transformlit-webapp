import { Resolver, Subscription } from '@nestjs/graphql';
import { PubSubService } from './pubsub.service.js';

@Resolver()
export class ChatResolver {
  constructor(private readonly pubSub: PubSubService) {}

  @Subscription(() => String, { name: 'messageAdded' })
  messageAdded() {
    return this.pubSub.asyncIterator('messageAdded');
  }
}
