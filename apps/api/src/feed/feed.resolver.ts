import { Resolver } from '@nestjs/graphql';

@Resolver()
export class FeedResolver {
  constructor(private readonly feedService: any) {}
}
