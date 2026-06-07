import {IsDateString, IsEnum, IsOptional, IsString} from 'class-validator';
import {ExecutionStatus} from '@prisma/client';
import {PaginationDto} from 'common/dto/pagination.dto';

export class ListExecutionsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  workflowId?: string;

  @IsOptional()
  @IsEnum(ExecutionStatus)
  status?: ExecutionStatus;

  @IsOptional()
  @IsDateString()
  since?: string;
}
