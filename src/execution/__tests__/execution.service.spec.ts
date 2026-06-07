import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { ExecutionService } from '../execution.service';
import { PrismaService } from 'infra/database/prisma.service';

const mockWorkflow = {
  id: 'wf-1',
  tenantId: 'tenant-1',
  currentVersion: 1,
  name: 'Test Workflow',
};

const mockVersion = { id: 'ver-1', workflowDefinitionId: 'wf-1', version: 1 };

const mockExecution = {
  id: 'exec-1',
  tenantId: 'tenant-1',
  workflowDefinitionId: 'wf-1',
  workflowVersionId: 'ver-1',
  triggeredById: 'user-1',
  status: 'PENDING',
  createdAt: new Date(),
};

describe('ExecutionService', () => {
  let service: ExecutionService;
  let prisma: any;
  let queue: any;

  beforeEach(async () => {
    prisma = {
      workflowDefinition: {
        findFirst: jest.fn(),
      },
      workflowVersion: {
        findUnique: jest.fn(),
      },
      execution: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    queue = { add: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('execution'), useValue: queue },
      ],
    }).compile();

    service = module.get<ExecutionService>(ExecutionService);
  });

  describe('triggerManual', () => {
    it('creates execution and enqueues job', async () => {
      prisma.workflowDefinition.findFirst.mockResolvedValue(mockWorkflow);
      prisma.workflowVersion.findUnique.mockResolvedValue(mockVersion);
      prisma.execution.create.mockResolvedValue(mockExecution);

      const result = await service.triggerManual('tenant-1', 'wf-1', 'user-1', {});

      expect(prisma.execution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING', workflowDefinitionId: 'wf-1' }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith('run', expect.objectContaining({ executionId: 'exec-1' }));
      expect(result.id).toBe('exec-1');
    });

    it('throws NotFoundException when workflow not found', async () => {
      prisma.workflowDefinition.findFirst.mockResolvedValue(null);
      await expect(service.triggerManual('tenant-1', 'missing', 'user-1', {})).rejects.toThrow(
        NotFoundException,
      );
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns paginated executions', async () => {
      prisma.execution.findMany.mockResolvedValue([mockExecution]);
      prisma.execution.count.mockResolvedValue(1);

      const result = await service.findAll('tenant-1', { page: 1, limit: 20 });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.totalPages).toBe(1);
    });

    it('filters by workflowId', async () => {
      prisma.execution.findMany.mockResolvedValue([]);
      prisma.execution.count.mockResolvedValue(0);

      await service.findAll('tenant-1', { page: 1, limit: 20, workflowId: 'wf-1' });

      expect(prisma.execution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ workflowDefinitionId: 'wf-1' }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns execution when found', async () => {
      const fullExecution = { ...mockExecution, stepLogs: [], workflowDefinition: {}, workflowVersion: {}, triggeredBy: null };
      prisma.execution.findFirst.mockResolvedValue(fullExecution);

      const result = await service.findOne('tenant-1', 'exec-1');
      expect(result.id).toBe('exec-1');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.execution.findFirst.mockResolvedValue(null);
      await expect(service.findOne('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancel', () => {
    it('cancels a PENDING execution', async () => {
      const fullExecution = { ...mockExecution, stepLogs: [], workflowDefinition: {}, workflowVersion: {}, triggeredBy: null };
      prisma.execution.findFirst.mockResolvedValue(fullExecution);
      prisma.execution.update.mockResolvedValue({ ...mockExecution, status: 'CANCELLED' });

      const result = await service.cancel('tenant-1', 'exec-1');
      expect(result.status).toBe('CANCELLED');
      expect(prisma.execution.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
      );
    });

    it('throws BadRequestException when cancelling a completed execution', async () => {
      const completedExecution = { ...mockExecution, status: 'SUCCESS', stepLogs: [], workflowDefinition: {}, workflowVersion: {}, triggeredBy: null };
      prisma.execution.findFirst.mockResolvedValue(completedExecution);

      await expect(service.cancel('tenant-1', 'exec-1')).rejects.toThrow(BadRequestException);
    });
  });
});
