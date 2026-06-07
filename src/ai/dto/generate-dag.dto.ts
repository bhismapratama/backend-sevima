import {IsOptional, IsString, MaxLength, MinLength} from 'class-validator';

export class GenerateDagDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  context?: string;
}
