import {Module} from '@nestjs/common';
import {BullModule} from '@nestjs/bull';
import {ExecutionController} from './execution.controller';
import {ExecutionGateway} from './execution.gateway';
import {ExecutionProcessor} from './execution.processor';
import {ExecutionService} from './execution.service';

@Module({
  imports: [BullModule.registerQueue({name: 'execution'})],
  controllers: [ExecutionController],
  providers: [ExecutionService, ExecutionGateway, ExecutionProcessor],
  exports: [ExecutionService],
})
export class ExecutionModule {}
