import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { NotificationType } from '@transformlit/shared';
import { GraphQLJSON } from 'graphql-type-json';

registerEnumType(NotificationType, { name: 'NotificationType' });

@ObjectType()
export class Notification {
  @Field(() => ID)
  id: string;

  @Field(() => NotificationType)
  type: NotificationType;

  @Field(() => GraphQLJSON, { nullable: true })
  payload?: Record<string, unknown>;

  @Field({ nullable: true })
  readAt?: Date;

  @Field()
  createdAt: Date;
}
