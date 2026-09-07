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

  @Field(() => User)
  user: User;
}

// NOTE (httpOnly-refresh migration): the GraphQL auth mutations no longer
// return a refreshToken — refresh tokens are issued exclusively as an httpOnly
// cookie by the REST endpoints under AuthController (POST /auth/register,
// /auth/login, /auth/refresh). registerLocal/loginLocal are kept for back
// compatibility but cannot set the cookie; prefer the REST endpoints.

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
