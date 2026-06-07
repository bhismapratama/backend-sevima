import {ApiPropertyOptional} from '@nestjs/swagger';
import {WorkflowRole} from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  Matches,
} from 'class-validator';

export class UpdateMemberDto {
  @ApiPropertyOptional({example: 'newemail@acme.com'})
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({enum: WorkflowRole})
  @IsOptional()
  @IsEnum(WorkflowRole)
  role?: WorkflowRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/, {
    message: 'Kata sandi terlalu lemah.',
  })
  password?: string;
}
