import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {ApiBearerAuth, ApiTags} from '@nestjs/swagger';
import {ThrottlerGuard} from '@nestjs/throttler';
import {CurrentUser} from 'common/decorators/current-user.decorator';
import {AuthenticatedUser} from 'common/interfaces/authenticated-user.interface';
import {JwtGuard} from 'common/guards/jwt.guard';
import {RolesGuard} from 'common/guards/roles.guard';
import {ListExecutionsDto} from './dto';
import {ExecutionService} from './execution.service';

@ApiTags('executions')
@ApiBearerAuth()
@UseGuards(JwtGuard, RolesGuard, ThrottlerGuard)
@Controller('executions')
export class ExecutionController {
  constructor(private readonly executionService: ExecutionService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListExecutionsDto,
  ) {
    return this.executionService.findAll(user.tenantId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.executionService.findOne(user.tenantId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.executionService.cancel(user.tenantId, id);
  }
}
