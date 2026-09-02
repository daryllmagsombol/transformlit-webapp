import { Field, ObjectType, InputType, ID, Int, registerEnumType } from '@nestjs/graphql';
import { ConversationType } from '@transformlit/shared';
import { User } from '../../auth/models/auth.model.js';

registerEnumType(ConversationType, { name: 'ConversationType' });

@ObjectType()
export class ConversationGroup {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field({ nullable: true })
  coverImageUrl?: string;
}

@ObjectType()
export class Message {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  conversationId: string;

  @Field(() => ID)
  senderId: string;

  @Field(() => User, { nullable: true })
  sender?: User;

  @Field()
  body: string;

  @Field({ nullable: true })
  editedAt?: Date;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class Conversation {
  @Field(() => ID)
  id: string;

  @Field(() => ConversationType)
  type: ConversationType;

  @Field(() => ID, { nullable: true })
  groupId?: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  @Field(() => User, { nullable: true })
  otherUser?: User;

  @Field(() => ConversationGroup, { nullable: true })
  group?: ConversationGroup;

  @Field(() => Message, { nullable: true })
  lastMessage?: Message;

  @Field(() => Int)
  unreadCount: number;

  @Field({ nullable: true })
  myLastReadAt?: Date;
}

@ObjectType()
export class MessageEdge {
  @Field(() => Message)
  node: Message;

  @Field()
  cursor: string;
}

@ObjectType()
export class MessageConnection {
  @Field(() => [MessageEdge])
  edges: MessageEdge[];

  @Field()
  hasNextPage: boolean;
}

@InputType()
export class SendMessageInput {
  @Field(() => ID) conversationId: string;

  @Field() body: string;
}
