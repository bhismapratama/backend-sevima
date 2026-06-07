import {INestApplication, ValidationPipe, VersioningType} from '@nestjs/common';
import {Test, TestingModule} from '@nestjs/testing';
import request from 'supertest';
import {App} from 'supertest/types';
import {AppModule} from '../src/app.module';
import {PrismaService} from '../src/infra/database/prisma.service';

const TEST_TENANT = `e2e-tenant-${Date.now()}`;
const TEST_EMAIL = `e2e-${Date.now()}@flowforge.test`;
const TEST_PASSWORD = 'E2eP@ssw0rd!';

const SIMPLE_DAG = {
  steps: [
    {
      id: 'step-a',
      name: 'Step A',
      type: 'DELAY',
      config: {delayMs: 10},
      dependsOn: [],
    },
    {
      id: 'step-b',
      name: 'Step B',
      type: 'DELAY',
      config: {delayMs: 10},
      dependsOn: ['step-a'],
    },
  ],
};

describe('Workflow Execution (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;
  let workflowId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();

    app.enableVersioning({type: VersioningType.URI, defaultVersion: '1'});
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({where: {slug: TEST_TENANT}});
    await app.close();
  });

  describe('POST /v1/auth/register', () => {
    it('registers a new tenant and admin user', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({
          tenantName: 'E2E Test Corp',
          tenantSlug: TEST_TENANT,
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
        })
        .expect(201);

      expect(res.body.data).toMatchObject({email: TEST_EMAIL});
      expect(res.body.data.role).toBe('ADMIN');
    });

    it('rejects duplicate tenant slug with 409', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({
          tenantName: 'Duplicate',
          tenantSlug: TEST_TENANT,
          email: 'other@test.com',
          password: TEST_PASSWORD,
        })
        .expect(409);
    });
  });

  describe('POST /v1/auth/login', () => {
    it('returns a JWT for valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({email: TEST_EMAIL, password: TEST_PASSWORD})
        .expect(201);

      expect(res.body.data.accessToken).toBeDefined();
      accessToken = res.body.data.accessToken as string;
    });

    it('rejects wrong password with 401', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({email: TEST_EMAIL, password: 'wrongpassword'})
        .expect(401);
    });
  });

  describe('POST /v1/workflows', () => {
    it('creates a workflow with valid DAG', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({name: 'E2E Workflow', dag: SIMPLE_DAG})
        .expect(201);

      expect(res.body.data.name).toBe('E2E Workflow');
      expect(res.body.data.currentVersion).toBe(1);
      workflowId = res.body.data.id as string;
    });

    it('rejects an invalid DAG (no steps)', async () => {
      await request(app.getHttpServer())
        .post('/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({name: 'Bad', definition: {steps: []}})
        .expect(400);
    });

    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .post('/v1/workflows')
        .send({name: 'No Auth', dag: SIMPLE_DAG})
        .expect(401);
    });
  });

  describe('GET /v1/workflows', () => {
    it('lists workflows with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/workflows?page=1&limit=10')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data.items).toBeInstanceOf(Array);
      expect(res.body.data.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data.page).toBe(1);
    });
  });

  describe('PATCH /v1/workflows/:id', () => {
    it('creates a new version on update', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/workflows/${workflowId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({name: 'E2E Workflow Updated'})
        .expect(200);

      expect(res.body.data.currentVersion).toBe(2);
      expect(res.body.data.name).toBe('E2E Workflow Updated');
    });
  });

  describe('POST /v1/workflows/:id/rollback', () => {
    it('rolls back to version 1', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/workflows/${workflowId}/rollback`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({version: 1})
        .expect(201);

      expect(res.body.data.currentVersion).toBe(1);
    });

    it('rejects rollback to non-existent version with 404', async () => {
      await request(app.getHttpServer())
        .post(`/v1/workflows/${workflowId}/rollback`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({version: 999})
        .expect(404);
    });
  });

  describe('POST /v1/workflows/:id/execute + GET /v1/executions/:id', () => {
    let executionId: string;

    it('triggers execution and returns 202 Accepted', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/workflows/${workflowId}/execute`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(202);

      expect(res.body.data.executionId).toBeDefined();
      executionId = res.body.data.executionId as string;
    });

    it('polls execution until it reaches a terminal state', async () => {
      const deadline = Date.now() + 8_000;
      let finalStatus = 'PENDING';

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));

        const res = await request(app.getHttpServer())
          .get(`/v1/executions/${executionId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        finalStatus = res.body.data.status as string;
        if (['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'].includes(finalStatus))
          break;
      }

      expect(finalStatus).toBe('SUCCESS');
    });

    it('retrieves execution detail with step logs', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/executions/${executionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data.stepLogs).toBeInstanceOf(Array);
      expect(res.body.data.stepLogs).toHaveLength(2);
      expect(
        res.body.data.stepLogs.every((l: any) => l.status === 'SUCCESS'),
      ).toBe(true);
      expect(res.body.data.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('POST /v1/executions/:id/cancel', () => {
    it('cancels a PENDING execution before processing', async () => {
      const execRes = await request(app.getHttpServer())
        .post(`/v1/workflows/${workflowId}/execute`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(202);

      const newExecId = execRes.body.data.executionId as string;

      const cancelRes = await request(app.getHttpServer())
        .post(`/v1/executions/${newExecId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(cancelRes.body.data.status).toBe('CANCELLED');
    });
  });

  describe('GET /v1/workflows/:id/versions', () => {
    it('returns all versions in descending order', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/workflows/${workflowId}/versions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const versions = res.body.data as Array<{version: number}>;
      expect(versions).toBeInstanceOf(Array);
      expect(versions.length).toBeGreaterThanOrEqual(2);
      expect(versions[0].version).toBeGreaterThan(
        versions[versions.length - 1].version,
      );
    });
  });
});
