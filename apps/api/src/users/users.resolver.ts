import { Resolver } from '@nestjs/graphql';

@Resolver()
export class UsersResolver {
  constructor(private readonly usersService: any) {}
}
