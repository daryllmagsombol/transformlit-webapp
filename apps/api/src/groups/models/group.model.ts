import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { GroupVisibility, GroupMemberRole, GroupMemberStatus } from '@transformlit/shared';

registerEnumType(GroupVisibility, { name: 'GroupVisibility' });
registerEnumType(GroupMemberRole, { name: 'GroupMemberRole' });
registerEnumType(GroupMemberStatus, { name: 'GroupMemberStatus' });

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

  @Field()
  memberCount: number;

  @Field({ nullable: true })
  myRole?: GroupMemberRole;

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
}
