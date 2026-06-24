import { Resolver } from '@nestjs/graphql';

@Resolver()
export class FriendsResolver {
  constructor(private readonly friendsService: any) {}
}
