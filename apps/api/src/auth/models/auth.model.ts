import { Field, ObjectType, InputType, ID, registerEnumType } from '@nestjs/graphql';
import { UserRole } from '@transformlit/shared';

registerEnumType(UserRole, { name: 'UserRole' });

@ObjectType()
export class User {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;

  @Field()
  displayName: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field({ nullable: true })
  bio?: string;

  @Field(() => UserRole)
  role: UserRole;

  @Field()
  status: string;

  @Field({ nullable: true })
  lastLoginAt?: Date;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class AuthPayload {
  @Field()
  accessToken: string;

  @Field()
  refreshToken: string;

  @Field(() => User)
  user: User;
}

@InputType()
export class RegisterLocalInput {
  @Field(() => String) email: string;
  @Field(() => String) password: string;
  @Field(() => String) displayName: string;
}

@InputType()
export class LoginLocalInput {
  @Field() email: string;
  @Field() password: string;
}
