import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { FriendshipStatus } from '@transformlit/shared';
import { User } from '../../auth/models/auth.model.js';

registerEnumType(FriendshipStatus, { name: 'FriendshipStatus' });

@ObjectType()
export class Friendship {
  @Field(() => ID)
  id: string;

  @Field()
  requesterId: string;

  @Field()
  addresseeId: string;

  @Field(() => User, { nullable: true })
  requester?: User;

  @Field(() => User, { nullable: true })
  addressee?: User;

  @Field(() => FriendshipStatus)
  status: FriendshipStatus;

  @Field()
  createdAt: Date;
}
