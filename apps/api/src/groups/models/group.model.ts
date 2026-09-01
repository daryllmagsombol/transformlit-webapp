import {
  Field,
  ObjectType,
  InputType,
  ID,
  Int,
  registerEnumType,
} from '@nestjs/graphql';
import {
  GroupVisibility,
  GroupMemberRole,
  GroupMemberStatus,
  GroupCategory,
} from '@transformlit/shared';
import { User } from '../../auth/models/auth.model.js';

registerEnumType(GroupVisibility, { name: 'GroupVisibility' });
registerEnumType(GroupMemberRole, { name: 'GroupMemberRole' });
registerEnumType(GroupMemberStatus, { name: 'GroupMemberStatus' });
registerEnumType(GroupCategory, { name: 'GroupCategory' });

@ObjectType()
export class Group {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => GroupVisibility)
  visibility: GroupVisibility;

  @Field(() => GroupCategory, { nullable: true })
  category?: GroupCategory;

  @Field({ nullable: true })
  coverImageUrl?: string;

  @Field()
  featured: boolean;

  @Field(() => Int)
  memberCount: number;

  @Field({ nullable: true })
  myRole?: GroupMemberRole;

  @Field(() => GroupMemberStatus, { nullable: true })
  myStatus?: GroupMemberStatus;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class GroupMember {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  userId: string;

  @Field(() => GroupMemberRole)
  role: GroupMemberRole;

  @Field(() => GroupMemberStatus)
  status: GroupMemberStatus;

  @Field()
  joinedAt: Date;

  @Field(() => User, { nullable: true })
  user?: User;
}

@InputType()
export class CreateGroupInput {
  @Field() name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => GroupVisibility, { defaultValue: GroupVisibility.PUBLIC, nullable: true })
  visibility?: GroupVisibility;

  @Field(() => GroupCategory, { nullable: true })
  category?: GroupCategory;

  @Field({ nullable: true })
  coverImageUrl?: string;
}

@InputType()
export class UpdateGroupInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => GroupVisibility, { nullable: true })
  visibility?: GroupVisibility;

  @Field(() => GroupCategory, { nullable: true })
  category?: GroupCategory;

  @Field({ nullable: true })
  coverImageUrl?: string;

  @Field({ nullable: true })
  featured?: boolean;
}
