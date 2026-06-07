import {IsOptional, IsString, MaxLength} from 'class-validator';
import {PaginationDto} from 'common/dto/pagination.dto';

export class ListWorkflowsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
