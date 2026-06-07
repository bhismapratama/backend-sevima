import {Module} from '@nestjs/common';
import {ExecutionModule} from 'execution/execution.module';
import {TriggerController} from './trigger.controller';
import {TriggerService} from './trigger.service';
import {WebhookController} from './webhook.controller';

@Module({
  imports: [ExecutionModule],
  controllers: [TriggerController, WebhookController],
  providers: [TriggerService],
  exports: [TriggerService],
})
export class TriggerModule {}
