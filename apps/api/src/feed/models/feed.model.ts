import { Field, ObjectType, InputType, ID, registerEnumType } from '@nestjs/graphql';
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

@InputType()
export class PublishAnnouncementInput {
  @Field() title: string;

  @Field() body: string;

  @Field({ nullable: true })
  publishAt?: string;

  @Field({ nullable: true })
  expiresAt?: string;
}

@InputType()
export class UpdateAnnouncementInput {
  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  body?: string;

  @Field({ nullable: true })
  publishAt?: string;

  @Field({ nullable: true })
  expiresAt?: string;
}
