import {Body, Controller, Headers, HttpCode, Param, Post} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {TriggerService} from './trigger.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly triggerService: TriggerService) {}

  @Post(':uuid')
  @HttpCode(202)
  handle(
    @Param('uuid') uuid: string,
    @Body() body: unknown,
    @Headers('x-flowforge-signature') signature: string | undefined,
    @Headers('x-flowforge-nonce') nonce: string | undefined,
  ) {
    return this.triggerService.verifyAndHandleWebhook(
      `/webhooks/${uuid}`,
      body,
      signature,
      nonce,
    );
  }
}
