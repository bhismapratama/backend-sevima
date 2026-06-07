import {APP_INTERCEPTOR} from '@nestjs/core';
import {Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';
import {ScheduleModule} from '@nestjs/schedule';
import {ThrottlerModule} from '@nestjs/throttler';
import {BullModule} from '@nestjs/bull';
import {PrismaModule} from 'infra/database/prisma.module';
import {RedisModule} from 'infra/redis/redis.module';
import {AuthModule} from 'auth/auth.module';
import {WorkflowModule} from 'workflow/workflow.module';
import {ExecutionModule} from 'execution/execution.module';
import {TriggerModule} from 'trigger/trigger.module';
import {AiModule} from 'ai/ai.module';
import {HealthModule} from './health/health.module';
import {ResponseInterceptor} from 'common/interceptors';

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true}),

    ScheduleModule.forRoot(),

    ThrottlerModule.forRoot([{ttl: 60_000, limit: 100}]),

    BullModule.forRootAsync({
      useFactory: () => ({
        redis: {
          host: process.env.REDIS_HOST ?? 'localhost',
          port: Number(process.env.REDIS_PORT ?? 6379),
        },
      }),
    }),

    PrismaModule,
    RedisModule,
    AuthModule,
    ExecutionModule,
    WorkflowModule,
    TriggerModule,
    AiModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
  ],
})
export class AppModule {}
