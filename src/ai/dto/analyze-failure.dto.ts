import {IsString} from 'class-validator';

export class AnalyzeFailureDto {
  @IsString()
  executionId!: string;
}
