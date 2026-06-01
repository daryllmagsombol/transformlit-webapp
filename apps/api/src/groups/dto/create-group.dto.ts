import { IsNotEmpty, IsOptional, IsEnum, IsString } from 'class-validator';
import { GroupVisibility } from '@prisma/client';

export class CreateGroupDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(GroupVisibility)
  visibility?: GroupVisibility;
}
