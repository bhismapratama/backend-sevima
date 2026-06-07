import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowService } from '../workflow.service';
import { PrismaService } from 'infra/database/prisma.service';
import { REDIS_CLIENT } from 'infra/redis/redis.module';

const VALID_DAG = {
  steps: [
    { id: 'a', name: 'A', type: 'DELAY', config: { delayMs: 0 }, dependsOn: [] },
  ],
};

const INVALID_DAG = { steps: [] };

const mockWorkflow = {
  id: 'wf-1',
  tenantId: 'tenant-1',
  name: 'My Workflow',
  description: null,
  currentVersion: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  versions: [{ id: 'v-1', version: 1, dag: VALID_DAG, createdAt: new Date() }],
  triggers: [],
};

const mockVersion = { id: 'v-1', workflowDefinitionId: 'wf-1', version: 1, dag: VALID_DAG, createdAt: new Date() };

describe('WorkflowService', () => {
  let service: WorkflowService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      workflowDefinition: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      workflowVersion: {
        create: jest.fn().mockResolvedValue(mockVersion),
        findMany: jest.fn().mockResolvedValue([mockVersion]),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: { del: jest.fn() } },
      ],
    }).compile();

    service = module.get<WorkflowService>(WorkflowService);
  });

  describe('create', () => {
    it('creates workflow + version on valid DAG', async () => {
      prisma.workflowDefinition.create.mockResolvedValue(mockWorkflow);
      prisma.workflowDefinition.findUniqueOrThrow.mockResolvedValue(mockWorkflow);

      const result = await service.create('tenant-1', { name: 'My Workflow', dag: VALID_DAG });

      expect(prisma.workflowDefinition.create).toHaveBeenCalled();
      expect(prisma.workflowVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 1 }) }),
      );
      expect(result).toEqual(mockWorkflow);
    });

    it('throws BadRequestException on invalid DAG', async () => {
      await expect(
        service.create('tenant-1', { name: 'Bad', dag: INVALID_DAG as any }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.workflowDefinition.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns paginated result', async () => {
      const items = [{ id: 'wf-1', name: 'W', description: null, currentVersion: 1, createdAt: new Date(), updatedAt: new Date(), _count: { executions: 0 } }];
      prisma.workflowDefinition.findMany.mockResolvedValue(items);
      prisma.workflowDefinition.count.mockResolvedValue(1);

      const result = await service.findAll('tenant-1', { page: 1, limit: 20 });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.totalPages).toBe(1);
    });

    it('filters by search term', async () => {
      prisma.workflowDefinition.findMany.mockResolvedValue([]);
      prisma.workflowDefinition.count.mockResolvedValue(0);

      await service.findAll('tenant-1', { page: 1, limit: 20, search: 'hello' });

      expect(prisma.workflowDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ name: { contains: 'hello', mode: 'insensitive' } }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns workflow when found', async () => {
      prisma.workflowDefinition.findFirst.mockResolvedValue(mockWorkflow);
      const result = await service.findOne('tenant-1', 'wf-1');
      expect(result).toEqual(mockWorkflow);
    });

    it('throws NotFoundException when not found', async () => {
      prisma.workflowDefinition.findFirst.mockResolvedValue(null);
      await expect(service.findOne('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('creates a new version and increments currentVersion', async () => {
      prisma.workflowDefinition.findFirst.mockResolvedValue(mockWorkflow);
      prisma.workflowDefinition.update.mockResolvedValue({ ...mockWorkflow, currentVersion: 2 });

      const result = await service.update('tenant-1', 'wf-1', { name: 'Updated' });

      expect(prisma.workflowVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }),
      );
      expect(result.currentVersion).toBe(2);
    });

    it('throws BadRequestException on invalid new DAG', async () => {
      prisma.workflowDefinition.findFirst.mockResolvedValue(mockWorkflow);
      await expect(
        service.update('tenant-1', 'wf-1', { dag: INVALID_DAG as any }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rollback', () => {
    it('sets currentVersion to target version', async () => {
      prisma.workflowDefinition.findFirst.mockResolvedValue(mockWorkflow);
      prisma.workflowVersion.findUnique.mockResolvedValue(mockVersion);
      prisma.workflowDefinition.update.mockResolvedValue({ ...mockWorkflow, currentVersion: 1 });

      await service.rollback('tenant-1', 'wf-1', { version: 1 });

      expect(prisma.workflowDefinition.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { currentVersion: 1 } }),
      );
    });

    it('throws NotFoundException when target version does not exist', async () => {
      prisma.workflowDefinition.findFirst.mockResolvedValue(mockWorkflow);
      prisma.workflowVersion.findUnique.mockResolvedValue(null);

      await expect(service.rollback('tenant-1', 'wf-1', { version: 99 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes workflow', async () => {
      prisma.workflowDefinition.findFirst.mockResolvedValue(mockWorkflow);
      prisma.workflowDefinition.delete.mockResolvedValue(mockWorkflow);

      await service.remove('tenant-1', 'wf-1');

      expect(prisma.workflowDefinition.delete).toHaveBeenCalledWith({ where: { id: 'wf-1' } });
    });
  });
});
