import {Body, Controller, HttpCode, Post, UseGuards} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiTags} from '@nestjs/swagger';
import {JwtGuard} from 'common/guards/jwt.guard';
import {RolesGuard} from 'common/guards/roles.guard';
import {Roles} from 'common/decorators/roles.decorator';
import {CurrentUser} from 'common/decorators/current-user.decorator';
import {ThrottlerGuard} from '@nestjs/throttler';
import {AuthenticatedUser} from 'common/interfaces/authenticated-user.interface';
import {AiService} from './ai.service';
import {GenerateDagDto} from './dto/generate-dag.dto';
import {AnalyzeFailureDto} from './dto/analyze-failure.dto';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtGuard, RolesGuard, ThrottlerGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('generate-dag')
  @HttpCode(200)
  @Roles('ADMIN', 'EDITOR')
  @ApiOperation({
    summary: 'Generate a workflow DAG from a natural language description',
    description:
      'Uses Claude claude-haiku-4-5-20251001 to convert a plain-English workflow description into a valid FlowForge DAG. ' +
      'The generated DAG is validated before being returned - it can be passed directly to POST /workflows.',
  })
  generateDag(@Body() dto: GenerateDagDto) {
    return this.aiService.generateDag(dto);
  }

  @Post('analyze-failure')
  @HttpCode(200)
  @Roles('ADMIN', 'EDITOR', 'VIEWER')
  @ApiOperation({
    summary: 'Analyze a failed execution with AI',
    description:
      'Fetches step logs for the given execution and asks Claude claude-haiku-4-5-20251001 to ' +
      'diagnose the root cause and suggest actionable fixes. ' +
      'Returns { diagnosis: string, suggestions: string[] }.',
  })
  analyzeFailure(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AnalyzeFailureDto,
  ) {
    return this.aiService.analyzeFailure(user.tenantId, dto);
  }
}
