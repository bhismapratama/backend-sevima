import {Module} from '@nestjs/common';
import {PrismaModule} from 'infra/database/prisma.module';
import {HealthController} from './health.controller';
import {HealthService} from './health.service';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
