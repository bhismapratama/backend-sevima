/**
 * Integration tests for the Workflow + Execution REST API.
 *
 * These tests boot the full NestJS application against a real PostgreSQL
 * database (DATABASE_URL env var) and exercise the HTTP layer end-to-end.
 * They are designed to run in CI via the `pnpm test` command; the Jest config
 * maps the module aliases (auth/*, workflow/*, etc.) so no extra config is
 * needed.
 *
 * Isolation strategy:
 *   - Each suite creates a unique tenant + admin user via POST /api/auth/register.
 *   - afterAll deletes the tenant (cascade removes all child records).
 *   - Tests within a suite share the JWT so they can build on each other
 *     (create → read → update → execute) without repeating setup.
 */

import type {Server} from 'node:http';
import {INestApplication, ValidationPipe} from '@nestjs/common';
import {Test} from '@nestjs/testing';
import request from 'supertest';
import {PrismaClient} from '@prisma/client';
import {AppModule} from '../app.module';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const MINIMAL_DAG = {
  steps: [
    {
      id: 'step-delay',
      name: 'Wait a moment',
      type: 'DELAY',
      config: {delayMs: 1},
      dependsOn: [],
    },
  ],
};

describe('Workflow API (integration)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let token: string;
  let tenantId: string;
  let workflowId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    httpServer = app.getHttpServer() as Server;

    prisma = new PrismaClient();

    const slug = `test-${uid()}`;
    const res = await request(httpServer)
      .post('/api/auth/register')
      .send({
        tenantName: `Test Tenant ${slug}`,
        tenantSlug: slug,
        email: `admin-${slug}@test.local`,
        password: 'P@ssw0rd!1',
        role: 'ADMIN',
      })
      .expect(201);

    const loginRes = await request(httpServer)
      .post('/api/auth/login')
      .send({
        email: `admin-${slug}@test.local`,
        password: 'P@ssw0rd!1',
      })
      .expect(201);

    token = loginRes.body.data.accessToken as string;

    const me = await request(httpServer)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    tenantId = (me.body.data as {tenantId: string}).tenantId;

    void res;
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.tenant.delete({where: {id: tenantId}}).catch(() => {
      });
    }
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /api/workflows', () => {
    it('creates a workflow and returns 201', async () => {
      const res = await request(httpServer)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Integration Test Workflow',
          description: 'Created by integration test',
          dag: MINIMAL_DAG,
        })
        .expect(201);

      expect(res.body.data).toMatchObject({
        name: 'Integration Test Workflow',
        currentVersion: 1,
      });

      workflowId = (res.body.data as {id: string}).id;
      expect(workflowId).toBeDefined();
    });

    it('returns 400 when DAG is missing', async () => {
      await request(httpServer)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .send({name: 'No DAG'})
        .expect(400);
    });

    it('returns 401 without a JWT', async () => {
      await request(httpServer)
        .post('/api/workflows')
        .send({name: 'Unauth', dag: MINIMAL_DAG})
        .expect(401);
    });
  });

  describe('GET /api/workflows', () => {
    it('returns a paginated list including the created workflow', async () => {
      const res = await request(httpServer)
        .get('/api/workflows')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body.data as {items: Array<{id: string}>; total: number};
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.items.some((w) => w.id === workflowId)).toBe(true);
    });

    it('filters by search term', async () => {
      const res = await request(httpServer)
        .get('/api/workflows')
        .query({search: 'Integration Test'})
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body.data as {items: Array<{name: string}>};
      expect(body.items.every((w) => w.name.includes('Integration Test'))).toBe(
        true,
      );
    });
  });

  describe('GET /api/workflows/:id', () => {
    it('returns the workflow detail with versions', async () => {
      const res = await request(httpServer)
        .get(`/api/workflows/${workflowId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: workflowId,
        currentVersion: 1,
      });
      expect(
        Array.isArray((res.body.data as {versions: unknown[]}).versions),
      ).toBe(true);
    });

    it('returns 404 for a non-existent workflow', async () => {
      await request(httpServer)
        .get('/api/workflows/does-not-exist')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('PATCH /api/workflows/:id', () => {
    it('updates the workflow and bumps the version to 2', async () => {
      const updatedDag = {
        ...MINIMAL_DAG,
        steps: [
          ...MINIMAL_DAG.steps,
          {
            id: 'step-delay-2',
            name: 'Second delay',
            type: 'DELAY',
            config: {delayMs: 1},
            dependsOn: ['step-delay'],
          },
        ],
      };

      const res = await request(httpServer)
        .patch(`/api/workflows/${workflowId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({dag: updatedDag})
        .expect(200);

      expect((res.body.data as {currentVersion: number}).currentVersion).toBe(2);
    });
  });

  describe('POST /api/workflows/:id/execute', () => {
    it('enqueues an execution and returns 202 with executionId', async () => {
      const res = await request(httpServer)
        .post(`/api/workflows/${workflowId}/execute`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(202);

      const executionId = (res.body.data as {id: string}).id;
      expect(executionId).toBeDefined();
    });
  });

  describe('GET /api/executions', () => {
    it('returns a paginated execution list for the tenant', async () => {
      const res = await request(httpServer)
        .get('/api/executions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body.data as {items: unknown[]; total: number};
      expect(typeof body.total).toBe('number');
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('filters by workflowId', async () => {
      const res = await request(httpServer)
        .get('/api/executions')
        .query({workflowId})
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const items = (res.body.data as {items: Array<{workflowDefinitionId: string}>}).items;
      expect(items.every((e) => e.workflowDefinitionId === workflowId)).toBe(
        true,
      );
    });
  });
});
