import {IsObject, IsOptional} from 'class-validator';

export class TriggerExecutionDto {
  @IsOptional()
  @IsObject()
  globals?: Record<string, unknown>;
}
