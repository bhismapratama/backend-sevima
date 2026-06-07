import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {ApiBearerAuth, ApiTags} from '@nestjs/swagger';
import {WorkflowRole} from '@prisma/client';
import {ThrottlerGuard} from '@nestjs/throttler';
import {CurrentUser} from 'common/decorators/current-user.decorator';
import {AuthenticatedUser} from 'common/interfaces/authenticated-user.interface';
import {Roles} from 'common/decorators/roles.decorator';
import {JwtGuard} from 'common/guards/jwt.guard';
import {RolesGuard} from 'common/guards/roles.guard';
import {CreateTriggerDto} from './dto';
import {TriggerService} from './trigger.service';

@ApiTags('triggers')
@ApiBearerAuth()
@UseGuards(JwtGuard, RolesGuard, ThrottlerGuard)
@Controller('triggers')
export class TriggerController {
  constructor(private readonly triggerService: TriggerService) {}

  @Post()
  @HttpCode(201)
  @Roles(WorkflowRole.ADMIN, WorkflowRole.EDITOR)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTriggerDto,
  ) {
    return this.triggerService.createTrigger(user.tenantId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('workflowId') workflowId?: string,
  ) {
    return this.triggerService.listTriggers(user.tenantId, workflowId);
  }

  @Patch(':id/toggle')
  @Roles(WorkflowRole.ADMIN, WorkflowRole.EDITOR)
  toggle(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.triggerService.toggleTrigger(user.tenantId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(WorkflowRole.ADMIN)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.triggerService.deleteTrigger(user.tenantId, id);
  }
}
