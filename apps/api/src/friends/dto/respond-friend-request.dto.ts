import { IsEnum, IsUUID } from 'class-validator';
import { FriendshipStatus } from '@prisma/client';

export class RespondFriendRequestDto {
  @IsUUID()
  requestId: string;

  @IsEnum(FriendshipStatus)
  status: FriendshipStatus;
}
