import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { BookAccessLevel, BookStatus } from '@transformlit/shared';

registerEnumType(BookAccessLevel, { name: 'BookAccessLevel' });
registerEnumType(BookStatus, { name: 'BookStatus' });

@ObjectType()
export class Book {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  author?: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  coverUrl?: string;

  @Field({ nullable: true })
  price?: number;

  @Field({ nullable: true })
  currency?: string;

  @Field(() => BookAccessLevel)
  accessLevel: BookAccessLevel;

  @Field(() => BookStatus)
  status: BookStatus;

  @Field({ nullable: true })
  totalPages?: number;

  @Field({ nullable: true })
  publishedAt?: Date;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class BookProgress {
  @Field(() => ID)
  bookId: string;

  @Field()
  currentPage: number;

  @Field({ nullable: true })
  scrollY?: number;

  @Field({ nullable: true })
  completedAt?: Date;

  @Field()
  lastReadAt: Date;
}

@ObjectType()
export class Bookmark {
  @Field(() => ID)
  id: string;

  @Field()
  page: number;

  @Field({ nullable: true })
  label?: string;

  @Field({ nullable: true })
  color?: string;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class Highlight {
  @Field(() => ID)
  id: string;

  @Field()
  page: number;

  @Field()
  text: string;

  @Field({ nullable: true })
  note?: string;

  @Field({ nullable: true })
  color?: string;

  @Field()
  createdAt: Date;
}
