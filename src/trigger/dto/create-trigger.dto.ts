import {IsEnum, IsOptional, IsString, MinLength} from 'class-validator';
import {TriggerType} from '@prisma/client';

export class CreateTriggerDto {
  @IsString()
  @MinLength(1)
  workflowId!: string;

  @IsEnum(TriggerType)
  type!: TriggerType;

  @IsOptional()
  @IsString()
  cronExpression?: string;
}
