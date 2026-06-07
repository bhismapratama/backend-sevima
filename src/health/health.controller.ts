import {Controller, Get, UseGuards} from '@nestjs/common';
import {ApiBearerAuth, ApiTags} from '@nestjs/swagger';
import {CurrentUser} from 'common/decorators/current-user.decorator';
import {AuthenticatedUser} from 'common/interfaces/authenticated-user.interface';
import {HealthService} from './health.service';
import {JwtGuard} from 'common/guards/jwt.guard';

@ApiTags('health')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('metrics')
  getMetrics(@CurrentUser() user: AuthenticatedUser) {
    return this.healthService.getMetrics(user.tenantId);
  }
}
