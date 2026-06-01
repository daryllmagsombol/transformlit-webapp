import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  tenantSlug: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
