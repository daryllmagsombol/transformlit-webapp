import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { FriendshipStatus } from '@transformlit/shared';

registerEnumType(FriendshipStatus, { name: 'FriendshipStatus' });

@ObjectType()
export class Friendship {
  @Field(() => ID)
  id: string;

  @Field()
  requesterId: string;

  @Field()
  addresseeId: string;

  @Field(() => FriendshipStatus)
  status: FriendshipStatus;

  @Field()
  createdAt: Date;
}
