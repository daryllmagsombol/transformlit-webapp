import { Resolver } from '@nestjs/graphql';

@Resolver()
export class BooksResolver {
  constructor(private readonly booksService: any) {}
}
