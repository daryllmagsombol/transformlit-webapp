import { Field, ObjectType, InputType, ID, Int, registerEnumType } from '@nestjs/graphql';
import { BookAccessLevel, BookFormat, BookStatus, ConversionStatus } from '@transformlit/shared';

registerEnumType(BookAccessLevel, { name: 'BookAccessLevel' });
registerEnumType(BookStatus, { name: 'BookStatus' });
registerEnumType(BookFormat, { name: 'BookFormat' });
registerEnumType(ConversionStatus, { name: 'ConversionStatus' });

@ObjectType()
export class BookTocEntry {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  depth: number;

  @Field(() => Int)
  order: number;
}

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

  @Field(() => BookFormat, { nullable: true })
  format?: BookFormat;

  @Field(() => ConversionStatus)
  conversionStatus: ConversionStatus;

  @Field(() => Int, { nullable: true })
  pageCount?: number;

  @Field(() => [BookTocEntry])
  toc: BookTocEntry[];

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

  @Field(() => Book, { nullable: true })
  book?: Book;

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

@InputType()
export class UploadBookInput {
  @Field() title: string;

  @Field({ nullable: true })
  author?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => BookAccessLevel)
  accessLevel: BookAccessLevel;

  @Field({ nullable: true })
  price?: number;

  @Field({ nullable: true })
  currency?: string;
}

@InputType()
export class UpdateBookInput {
  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  author?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => BookAccessLevel, { nullable: true })
  accessLevel?: BookAccessLevel;

  @Field({ nullable: true })
  price?: number;

  @Field(() => BookStatus, { nullable: true })
  status?: BookStatus;
}

@InputType()
export class SaveProgressInput {
  @Field(() => ID) bookId: string;

  @Field() currentPage: number;

  @Field({ nullable: true })
  scrollY?: number;
}

@InputType()
export class AddBookmarkInput {
  @Field(() => ID) bookId: string;

  @Field() page: number;

  @Field({ nullable: true })
  label?: string;

  @Field({ nullable: true })
  color?: string;
}

@InputType()
export class AddHighlightInput {
  @Field(() => ID) bookId: string;

  @Field() page: number;

  @Field() text: string;

  @Field({ nullable: true })
  note?: string;

  @Field({ nullable: true })
  color?: string;
}
