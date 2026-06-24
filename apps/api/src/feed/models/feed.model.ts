import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { AnnouncementStatus } from '@transformlit/shared';

registerEnumType(AnnouncementStatus, { name: 'AnnouncementStatus' });

@ObjectType()
export class Announcement {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field()
  body: string;

  @Field(() => AnnouncementStatus)
  status: AnnouncementStatus;

  @Field({ nullable: true })
  publishAt?: Date;

  @Field({ nullable: true })
  expiresAt?: Date;

  @Field({ nullable: true })
  publishedAt?: Date;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class VerseOfDay {
  @Field()
  date: string;

  @Field()
  text: string;

  @Field()
  reference: string;

  @Field()
  version: string;
}
