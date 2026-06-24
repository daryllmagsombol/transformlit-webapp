import { Resolver } from '@nestjs/graphql';

@Resolver()
export class GroupsResolver {
  constructor(private readonly groupsService: any) {}
}
