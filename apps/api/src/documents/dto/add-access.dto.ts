import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { DocumentAccessType } from '@prisma/client';

export class AddAccessDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsEnum(DocumentAccessType)
  accessType: DocumentAccessType;
}
