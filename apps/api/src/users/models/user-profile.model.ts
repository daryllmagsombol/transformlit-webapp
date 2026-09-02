import { Field, ObjectType, Int } from '@nestjs/graphql';
import { User } from '../../auth/models/auth.model.js';
import { Group } from '../../groups/models/group.model.js';
import { BookProgress } from '../../books/models/book.model.js';

@ObjectType()
export class UserProfile {
  @Field(() => User)
  user: User;

  @Field(() => [Group])
  groups: Group[];

  @Field(() => [BookProgress])
  bookProgress: BookProgress[];

  @Field(() => Int)
  friendCount: number;

  @Field(() => Int)
  groupCount: number;

  @Field(() => Int)
  bookCount: number;
}
