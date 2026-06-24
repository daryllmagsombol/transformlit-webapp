import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { ConversationType } from '@transformlit/shared';

registerEnumType(ConversationType, { name: 'ConversationType' });

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
}

@ObjectType()
export class Message {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  conversationId: string;

  @Field(() => ID)
  senderId: string;

  @Field()
  body: string;

  @Field({ nullable: true })
  editedAt?: Date;

  @Field()
  createdAt: Date;
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
  totalCount: number;

  @Field()
  hasNextPage: boolean;
}
