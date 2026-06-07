import {IsInt, Min} from 'class-validator';

export class RollbackWorkflowDto {
  @IsInt()
  @Min(1)
  version!: number;
}
