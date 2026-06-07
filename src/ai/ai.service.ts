import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import axios from 'axios';
import {validateDag} from 'workflow/core/dag-validator';
import {parseDag} from 'workflow/core/dag-parser';
import {WorkflowDefinition} from 'workflow/interfaces';
import {PrismaService} from 'infra/database/prisma.service';
import {GenerateDagDto} from './dto/generate-dag.dto';
import {AnalyzeFailureDto} from './dto/analyze-failure.dto';

interface AnthropicResponse {
  content: Array<{type: string; text: string}>;
}

const SYSTEM_PROMPT = `You are a workflow automation assistant. Convert natural language descriptions into FlowForge workflow DAG JSON.

A workflow DAG has this structure:
{
  "steps": [
    {
      "id": "unique-kebab-case-id",
      "name": "Human readable name",
      "type": "HTTP_CALL" | "SCRIPT" | "DELAY" | "CONDITION",
      "config": { ... type-specific fields ... },
      "dependsOn": ["step-id-1", "step-id-2"]
    }
  ],
  "timeoutMs": 300000
}

Step type configs:
- HTTP_CALL: { "url": "https://...", "method": "GET|POST|PUT|PATCH|DELETE", "headers": {}, "body": {} }
- SCRIPT: { "script": "return { result: input.prevStep.value * 2 };" }
- DELAY: { "delayMs": 5000 }
- CONDITION: { "expression": "\${{steps.fetch.output.status}} === 'active'" }

Rules:
1. Every step must have a unique id (kebab-case).
2. dependsOn must only reference IDs of other steps in the same workflow.
3. No cycles allowed.
4. The first step(s) must have dependsOn: [].
5. Return ONLY a valid JSON object - no explanation, no markdown fences.
6. If the request is ambiguous, make reasonable assumptions but keep the workflow minimal.
7. Never include actual secrets or credentials in config values.`;

export interface FailureAnalysis {
  diagnosis: string;
  suggestions: string[];
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async generateDag(dto: GenerateDagDto): Promise<WorkflowDefinition> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Fitur AI tidak dikonfigurasi (ANTHROPIC_API_KEY tidak ada)',
      );
    }

    const userMessage = dto.context
      ? `Context: ${dto.context}\n\nWorkflow description: ${dto.prompt}`
      : dto.prompt;

    let rawJson: string;

    try {
      const response = await axios.post<AnthropicResponse>(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [{role: 'user', content: userMessage}],
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          timeout: 30_000,
        },
      );

      rawJson = response.data.content?.[0]?.text ?? '';
    } catch (err: unknown) {
      const detail: unknown = axios.isAxiosError(err)
        ? (err.response?.data as unknown)
        : err instanceof Error
          ? err.message
          : String(err);
      this.logger.error('Anthropic API call failed', detail);
      throw new ServiceUnavailableException(
        'Layanan AI sementara tidak tersedia',
      );
    }

    return this.parseAndValidate(rawJson, dto.prompt);
  }

  async analyzeFailure(
    tenantId: string,
    dto: AnalyzeFailureDto,
  ): Promise<FailureAnalysis> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Fitur AI tidak dikonfigurasi (ANTHROPIC_API_KEY tidak ada)',
      );
    }

    const execution = await this.prisma.execution.findFirst({
      where: {id: dto.executionId, tenantId},
      include: {
        stepLogs: {orderBy: {startedAt: 'asc'}},
        workflowDefinition: {select: {name: true}},
      },
    });
    if (!execution) throw new NotFoundException('Eksekusi tidak ditemukan');

    const stepSummary = execution.stepLogs
      .map(
        (s) =>
          `  step="${s.stepName}" status=${s.status}` +
          (s.error ? ` error="${s.error.slice(0, 200)}"` : ''),
      )
      .join('\n');

    const rawContext = [
      `Workflow: ${execution.workflowDefinition?.name ?? execution.workflowDefinitionId}`,
      `Execution status: ${execution.status}`,
      execution.error
        ? `Top-level error: ${execution.error.slice(0, 400)}`
        : '',
      `Step results:\n${stepSummary}`,
    ]
      .filter(Boolean)
      .join('\n');

    const context = rawContext.slice(0, 2000);

    const systemPrompt =
      'You are a workflow reliability engineer. ' +
      'Given a failed workflow execution context, respond with ONLY a JSON object ' +
      '(no markdown fences) in this exact shape:\n' +
      '{"diagnosis":"<one paragraph root cause>","suggestions":["<fix 1>","<fix 2>","<fix 3>"]}\n' +
      'Be specific, actionable, and concise. Maximum 3 suggestions.';

    let rawText: string;
    try {
      const response = await axios.post<AnthropicResponse>(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: systemPrompt,
          messages: [{role: 'user', content: context}],
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          timeout: 30_000,
        },
      );
      rawText = response.data.content?.[0]?.text ?? '';
    } catch (err: unknown) {
      const detail = axios.isAxiosError(err)
        ? (err.response?.data as unknown)
        : err instanceof Error
          ? err.message
          : String(err);
      this.logger.error('Anthropic analyzeFailure call failed', detail);
      throw new ServiceUnavailableException(
        'Layanan AI sementara tidak tersedia',
      );
    }

    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    try {
      const parsed = JSON.parse(cleaned) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as Record<string, unknown>).diagnosis === 'string' &&
        Array.isArray((parsed as Record<string, unknown>).suggestions)
      ) {
        return parsed as FailureAnalysis;
      }
    } catch {
      this.logger.warn('analyzeFailure: LLM returned non-JSON', {rawText});
    }

    return {diagnosis: cleaned, suggestions: []};
  }

  private parseAndValidate(
    rawJson: string,
    originalPrompt: string,
  ): WorkflowDefinition {
    const cleaned = rawJson
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      this.logger.warn('LLM returned non-JSON output', {
        rawJson,
        originalPrompt,
      });
      throw new BadRequestException(
        'Tidak dapat menghasilkan workflow yang valid dari deskripsi tersebut. Coba lebih spesifik tentang langkah-langkahnya.',
      );
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>).steps)
    ) {
      throw new BadRequestException(
        'Output yang dihasilkan bukan definisi workflow yang valid.',
      );
    }

    const definition = parsed as WorkflowDefinition;

    const graph = parseDag(definition);
    const {valid, errors} = validateDag(definition, graph);
    if (!valid) {
      this.logger.warn('LLM generated invalid DAG', {errors, originalPrompt});
      throw new BadRequestException(
        `Workflow yang dihasilkan memiliki kesalahan validasi: ${errors.slice(0, 3).join('; ')}`,
      );
    }

    return definition;
  }
}
