import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {WorkflowRole} from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({example: 'Acme Corp'})
  @IsString()
  tenantName!: string;

  @ApiProperty({example: 'acme-corp'})
  @IsString()
  tenantSlug!: string;

  @ApiProperty({example: 'admin@acme.com'})
  @IsEmail()
  email!: string;

  @ApiProperty({example: 'P@ssw0rd!123'})
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/, {
    message:
      'Kata sandi terlalu lemah. Harus menyertakan huruf besar, huruf kecil, angka, karakter khusus.',
  })
  password!: string;

  @ApiPropertyOptional({enum: WorkflowRole, default: WorkflowRole.ADMIN})
  @IsOptional()
  @IsEnum(WorkflowRole)
  role?: WorkflowRole;
}
