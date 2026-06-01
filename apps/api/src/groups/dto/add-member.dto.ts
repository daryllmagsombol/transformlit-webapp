import { IsUUID, IsEnum, IsOptional } from 'class-validator';
import { GroupMemberRole } from '@prisma/client';

export class AddMemberDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @IsEnum(GroupMemberRole)
  role?: GroupMemberRole;
}
