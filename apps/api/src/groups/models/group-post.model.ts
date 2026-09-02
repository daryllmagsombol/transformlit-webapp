import { Field, ObjectType, InputType, ID, Int } from '@nestjs/graphql';
import { User } from '../../auth/models/auth.model.js';

@ObjectType()
export class GroupPost {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  groupId: string;

  @Field()
  body: string;

  @Field({ nullable: true })
  imageKey?: string;

  @Field()
  createdAt: Date;

  @Field(() => User, { nullable: true })
  author?: User;

  @Field(() => Int)
  likeCount: number;

  @Field(() => Int)
  commentCount: number;

  @Field()
  likedByMe: boolean;
}

@ObjectType()
export class GroupPostComment {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  postId: string;

  @Field()
  body: string;

  @Field()
  createdAt: Date;

  @Field(() => User, { nullable: true })
  author?: User;
}

@InputType()
export class CreateGroupPostInput {
  @Field()
  body: string;

  @Field({ nullable: true })
  imageKey?: string;
}