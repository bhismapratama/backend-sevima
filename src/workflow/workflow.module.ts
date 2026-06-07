import {Module} from '@nestjs/common';
import {ExecutionModule} from 'execution/execution.module';
import {WorkflowController} from './workflow.controller';
import {WorkflowService} from './workflow.service';

@Module({
  imports: [ExecutionModule],
  controllers: [WorkflowController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
