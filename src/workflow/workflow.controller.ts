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
import {ExecutionService} from 'execution/execution.service';
import {TriggerExecutionDto} from 'execution/dto';
import {
  CreateWorkflowDto,
  ListWorkflowsDto,
  RollbackWorkflowDto,
  UpdateWorkflowDto,
} from './dto';
import {WorkflowService} from './workflow.service';

@ApiTags('workflows')
@ApiBearerAuth()
@UseGuards(JwtGuard, RolesGuard, ThrottlerGuard)
@Controller('workflows')
export class WorkflowController {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly executionService: ExecutionService,
  ) {}

  @Post()
  @HttpCode(201)
  @Roles(WorkflowRole.ADMIN, WorkflowRole.EDITOR)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkflowDto,
  ) {
    return this.workflowService.create(user.tenantId, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListWorkflowsDto,
  ) {
    return this.workflowService.findAll(user.tenantId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.workflowService.findOne(user.tenantId, id);
  }

  @Patch(':id')
  @Roles(WorkflowRole.ADMIN, WorkflowRole.EDITOR)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    return this.workflowService.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(WorkflowRole.ADMIN)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.workflowService.remove(user.tenantId, id);
  }

  @Post(':id/rollback')
  @Roles(WorkflowRole.ADMIN, WorkflowRole.EDITOR)
  rollback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RollbackWorkflowDto,
  ) {
    return this.workflowService.rollback(user.tenantId, id, dto);
  }

  @Get(':id/versions')
  getVersions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.workflowService.getVersions(user.tenantId, id);
  }

  @Post(':id/execute')
  @HttpCode(202)
  @Roles(WorkflowRole.ADMIN, WorkflowRole.EDITOR)
  execute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TriggerExecutionDto,
  ) {
    return this.executionService.triggerManual(user.tenantId, id, user.id, dto);
  }
}
