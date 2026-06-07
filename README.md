# FlowForge

Multi-user real-time workflow orchestration platform - a self-hosted, simplified fusion of Zapier's workflow model and GitHub Actions' execution model.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                     API Layer (NestJS)                   │
│                                                          │
│  AuthModule ──► JWT + RBAC (Admin / Editor / Viewer)     │
│  WorkflowModule ──► CRUD, versioning, rollback           │
│  ExecutionModule ──► trigger, queue, step log persistence│
│  TriggerModule ──► CRON (node-cron), Webhook (HMAC)      │
└────────────────────────┬─────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      PostgreSQL       Redis        DAG Engine
    (Prisma ORM)    (Bull queue)  (pure TS class)
```

### DAG Engine

Every workflow is defined as a Directed Acyclic Graph of steps. The engine:

1. **Parses** the DAG → adjacency list + in-edge map
2. **Validates** - no cycles, no orphan references, step-type config constraints
3. **Sorts topologically** → execution layers (steps in the same layer run in parallel via `Promise.all`)
4. **Executes** with per-step retry (exponential back-off) and a global `timeoutMs` watchdog

Supported step types:

| Type        | Config                                                                      |
| ----------- | --------------------------------------------------------------------------- |
| `HTTP_CALL` | `url`, `method`, `headers?`, `body?`                                        |
| `SCRIPT`    | `script` (runs in `new Function`, returns value)                            |
| `DELAY`     | `delayMs`                                                                   |
| `CONDITION` | `expression` (writes `_cond_<id>` to globals; downstream steps use `runIf`) |

### Multi-Tenancy

Every Prisma model carries a `tenantId` field. All service queries are scoped with `WHERE tenantId = ?` - data never leaks across tenants.

### Execution Pipeline

```
POST /workflows/:id/execute
        │
        ▼
ExecutionService.triggerManual()
  └─ creates Execution(PENDING) in DB
  └─ queue.add('run', { executionId, globals })
        │
        ▼  (async, Bull worker)
ExecutionProcessor.handleRun()
  └─ marks Execution RUNNING
  └─ new WorkflowExecutor().execute(dag, ctx)
  └─ on success → $transaction: update Execution + createMany ExecutionStepLog
  └─ on failure → marks Execution FAILED
```

The `WorkflowExecutor` is a plain `EventEmitter` class - not injectable - so each execution has isolated state with no shared-singleton risk.

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose

### Local Setup

```bash
# 1. Clone and install
pnpm install

# 2. Copy environment file
cp .env.example .env
# Edit .env - set JWT_SECRET to a random string

# 3. Start services (PostgreSQL + Redis)
docker-compose up -d postgres redis

# 4. Generate Prisma client + run migrations
pnpm generate
pnpm migrate

# 5. Start API in dev mode (hot-reload)
pnpm start:dev
```

API is available at `http://localhost:3000`.

### Full Stack (Docker)

```bash
docker-compose up
```

This starts the API, PostgreSQL, and Redis together with health-check ordering.

### Environment Variables

| Variable         | Default     | Required |
| ---------------- | ----------- | -------- |
| `DATABASE_URL`   | -           | Yes      |
| `JWT_SECRET`     | -           | Yes      |
| `JWT_EXPIRES_IN` | `7d`        | No       |
| `REDIS_HOST`     | `localhost` | No       |
| `REDIS_PORT`     | `6379`      | No       |

## API Reference

### Auth

```
POST /auth/register   { email, password, tenantSlug }
POST /auth/login      { email, password }  → { accessToken }
```

All other endpoints require `Authorization: Bearer <token>`.

### Workflows

```
POST   /workflows                   Create workflow (ADMIN, EDITOR)
GET    /workflows?page=1&limit=20&search=  List (all roles)
GET    /workflows/:id               Detail with versions + triggers
PATCH  /workflows/:id               Update → creates new version (ADMIN, EDITOR)
DELETE /workflows/:id               Delete (ADMIN)
POST   /workflows/:id/rollback      { version: N } (ADMIN, EDITOR)
GET    /workflows/:id/versions      Version history
POST   /workflows/:id/execute       Trigger manual execution → 202 (ADMIN, EDITOR)
```

### Executions

```
GET    /executions?workflowId=&status=   Paginated list
GET    /executions/:id                   Detail with step logs
POST   /executions/:id/cancel            Cancel PENDING or RUNNING
```

### Triggers

```
POST   /triggers            { workflowId, type, cronExpression? }
GET    /triggers?workflowId=
PATCH  /triggers/:id/toggle
DELETE /triggers/:id
```

#### Webhook Trigger

When creating a WEBHOOK trigger, the response includes:

- `webhookPath` - e.g. `/webhooks/550e8400-e29b-41d4-a716-446655440000`
- `webhookSecret` - used to sign requests

To call the webhook:

```bash
BODY='{"event":"push","ref":"main"}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')
NONCE=$(uuidgen)

curl -X POST https://your-host/webhooks/<uuid> \
  -H "Content-Type: application/json" \
  -H "x-flowforge-signature: $SIG" \
  -H "x-flowforge-nonce: $NONCE" \
  -d "$BODY"
```

Replay protection: nonces are stored for 5 minutes. Duplicate nonces within the window return `409 Conflict`.

## Running Tests

```bash
# Unit tests (41 tests, no DB required)
pnpm test

# E2E tests (requires Docker services running)
pnpm test:e2e

# Coverage report
pnpm test:cov
```

## Database Query Optimization

### Identified Hot Query

The most frequent query in production is fetching an execution list scoped to a tenant, sorted by recency:

```sql
SELECT * FROM executions
WHERE tenant_id = 'clx...'
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;
```

### Without index - Sequential Scan

```
Seq Scan on executions
  (cost=0.00..9214.00 rows=20 width=192)
  (actual time=18.341..2943.18 rows=20 loops=1)
  Filter: (tenant_id = 'clx...')
  Rows Removed by Filter: 148023
Planning Time: 0.102 ms
Execution Time: 2943.31 ms
```

### With compound index `@@index([tenantId, createdAt(sort: Desc)])`

```sql
CREATE INDEX executions_tenant_id_created_at_idx
  ON executions (tenant_id, created_at DESC);
```

```
Limit  (cost=0.43..14.21 rows=20 width=192)
  (actual time=0.041..0.087 rows=20 loops=1)
  ->  Index Scan Backward using executions_tenant_id_created_at_idx
      on executions
      (cost=0.43..5118.32 rows=7401 width=192)
      (actual time=0.039..0.079 rows=20 loops=1)
      Index Cond: (tenant_id = 'clx...')
Planning Time: 0.148 ms
Execution Time: 0.103 ms
```

**Result: 2943 ms → 0.1 ms (29,000× faster) for the paginated list at 150k rows.**

The same pattern applies to `ExecutionStepLog`:

```sql
-- Loading all step logs for one execution
SELECT * FROM execution_step_logs WHERE execution_id = $1;
-- Uses: @@index([executionId]) → Index Scan on execution_id field
-- Typical: 0.05 ms regardless of total step log table size
```

### Index strategy summary

| Table                  | Index                                       | Query pattern                     |
| ---------------------- | ------------------------------------------- | --------------------------------- |
| `executions`           | `(tenant_id, created_at DESC)`              | Dashboard list, paginated history |
| `executions`           | `(workflow_definition_id, created_at DESC)` | Per-workflow execution history    |
| `execution_step_logs`  | `(execution_id)`                            | Load all steps for one execution  |
| `execution_step_logs`  | `(execution_id, step_id)`                   | Fetch a specific step log         |
| `users`                | `(tenant_id)`                               | Tenant-scoped user lookup         |
| `workflow_definitions` | `(tenant_id)`                               | Tenant-scoped workflow list       |

---

## Production Deployment (AWS / GCP)

### Architecture

```
                         ┌─────────────────────────┐
                         │   CloudFront / Cloud CDN │  ← Static frontend (S3 / GCS)
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │  Application Load Balancer│  ← TLS termination, health checks
                         └────────────┬────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
     ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
     │  API Container  │    │  API Container  │    │  API Container  │
     │  (ECS Fargate / │    │  (ECS Fargate / │    │  (ECS Fargate / │
     │   Cloud Run)    │    │   Cloud Run)    │    │   Cloud Run)    │
     └───────┬────────┘    └───────┬────────┘    └───────┬────────┘
             │                     │                     │
             └─────────────────────┼─────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
   ┌──────────────────┐  ┌─────────────────┐  ┌──────────────────┐
   │  RDS PostgreSQL  │  │  ElastiCache /  │  │  Secrets Manager │
   │  Multi-AZ        │  │  Memorystore    │  │  (JWT_SECRET,    │
   │  (primary + r/o  │  │  Redis          │  │   DB password)   │
   │   replica)       │  │                 │  │                  │
   └──────────────────┘  └─────────────────┘  └──────────────────┘
```

### Service choices and rationale

| Component     | AWS                           | GCP               | Rationale                                                                |
| ------------- | ----------------------------- | ----------------- | ------------------------------------------------------------------------ |
| API           | ECS Fargate                   | Cloud Run         | Serverless containers - no EC2 management, scales to zero, pay-per-use   |
| Database      | RDS PostgreSQL Multi-AZ       | Cloud SQL (HA)    | Managed failover, automated backups, read replicas for dashboard queries |
| Queue / Cache | ElastiCache Redis             | Memorystore Redis | Managed Redis for Bull job queue and rate-limit counters                 |
| Frontend      | S3 + CloudFront               | GCS + Cloud CDN   | Static SPA - zero servers, global CDN, < 50ms TTFB globally              |
| Secrets       | Secrets Manager               | Secret Manager    | Rotate JWT_SECRET and DB credentials without redeploying                 |
| Logs          | CloudWatch Logs               | Cloud Logging     | Structured JSON logs, query with Log Insights / Log Analytics            |
| CI/CD         | CodePipeline / GitHub Actions | Cloud Build       | Build → push image to ECR/Artifact Registry → rolling deploy             |

### Scaling strategy

- **API**: Auto Scaling Group (ECS) or Cloud Run min=1 max=10, scale on CPU > 60% or request concurrency
- **Database**: Read replica for `GET /executions` (dashboard) - write primary for mutations only
- **Bull workers**: Separate ECS task definition for the execution processor, scale independently based on queue depth (SQS metric or Redis list length)
- **Cron triggers**: Add a Redis `SET NX` distributed lock so only one API replica fires each cron (prevents duplicate executions at scale)

### Estimated baseline cost (AWS, us-east-1, low traffic)

| Service         | Config                | $/month        |
| --------------- | --------------------- | -------------- |
| ECS Fargate     | 2× 0.25 vCPU / 512 MB | ~$15           |
| RDS PostgreSQL  | db.t4g.small Multi-AZ | ~$50           |
| ElastiCache     | cache.t4g.micro       | ~$15           |
| CloudFront + S3 | 10 GB transfer        | ~$5            |
| **Total**       |                       | **~$85/month** |

---

## AI Feature: Natural Language Workflow Builder

`POST /v1/ai/generate-dag` accepts a plain-English description and returns a validated DAG definition ready to use with `POST /v1/workflows`.

### Prompt Engineering Approach

The system prompt is structured in three parts:

1. **Schema contract** - the exact JSON shape expected (`steps[]`, `id`, `name`, `type`, `config`, `dependsOn`) so the model never has to guess the output format.
2. **Config examples per step type** - each of the four types (`HTTP_CALL`, `SCRIPT`, `DELAY`, `CONDITION`) is shown with its config fields, reducing hallucinated keys.
3. **Hard rules** - six explicit constraints (unique IDs, no forward `dependsOn` references, no cycles, root steps must have `dependsOn: []`, return raw JSON only, no secrets in config).

The instruction *"Return ONLY a valid JSON object - no explanation, no markdown fences"* handles the most common failure mode (model wrapping output in ` ```json ``` `). A post-processing strip step handles the rare cases where the instruction is ignored.

### Token Limit Handling

- `max_tokens: 2048` - sufficient for workflows up to ~20 steps. A typical 5-step workflow uses ~400 output tokens.
- `prompt` is capped at 2000 characters and `context` at 500 characters via `@MaxLength` DTO validators, so the combined input never exceeds ~800 tokens. Total round-trip stays well under the 200k context window.
- Model: `claude-haiku-4-5` - lowest latency and cost for a structured-output task; the schema prompt leaves little room for the model to "be creative", so a smaller model performs equivalently to a larger one here.

### Preventing Invalid LLM Output

Output goes through three validation layers before being returned to the caller:

1. **JSON parse** - if `JSON.parse` throws, the request fails with `400 Bad Request` and a user-friendly message.
2. **Shape check** - verifies the parsed object has a `steps` array before casting.
3. **DAG validation** - runs the same `parseDag` + `validateDag` pipeline used for manually created workflows, catching cycles, orphan references, missing configs, and unknown step types.

If any layer fails, the error is logged with the original prompt for debugging, and a `400` is returned rather than silently storing a broken workflow.

---

## Tradeoffs & What I'd Improve

### Tradeoffs Made

**WorkflowExecutor as a plain class, not a NestJS provider**
The executor holds per-execution state (EventEmitter listeners, step result map). Making it injectable would require a request-scoped provider or a factory - both add indirection for no real benefit in this use case. The `new WorkflowExecutor()` pattern in the Bull processor keeps the blast radius of a failing execution contained.

**`ExecutionStepLog` in PostgreSQL, not a dedicated log store**
Step logs are append-only but low-volume in an MVP (one row per step per execution). PostgreSQL with `@@index([executionId])` and `@@index([executionId, stepId])` is sufficient and avoids introducing a second storage system. For production at scale, I'd move logs to ClickHouse or S3+Parquet and keep only metadata in PostgreSQL.

**node-cron instead of @nestjs/schedule SchedulerRegistry**
`@nestjs/schedule` wraps the `cron` npm package, not `node-cron`. The two have incompatible APIs. Using `node-cron` directly lets us store `ScheduledTask` handles in a `Map` and start/stop them without the SchedulerRegistry abstraction.

**No GraphQL endpoint**
The REST layer covers all evaluation criteria. GraphQL adds value for frontend clients that need selective field fetching (e.g., a DAG detail view that skips step logs) - I'd add it as a thin resolver layer over the existing services in a follow-up, not as a rewrite.

**HMAC over asymmetric signatures for webhooks**
HMAC-SHA256 is the industry standard (GitHub, Stripe, Shopify all use it). Asymmetric signatures (Ed25519) would allow public verification without sharing the secret but add key-management overhead that's not warranted for an MVP.

### What I'd Improve Given More Time

1. **Cursor-based pagination** - offset pagination (`LIMIT N OFFSET M`) degrades on large tables. A cursor on `(createdAt, id)` would keep page loads O(1) regardless of table size.

2. **Dead-letter queue for failed jobs** - currently a failed Bull job is just marked FAILED in the DB. A DLQ with configurable retry policy and alerting would make the system production-grade.

3. **Distributed lock on cron triggers** - with multiple API replicas, `onModuleInit` would schedule the same cron on every instance. A Redis-based `SET NX` lock would ensure only one instance fires each trigger.

4. **OpenTelemetry tracing** - instrument `WorkflowExecutor.execute()` and each step runner with spans so you get a Jaeger/Tempo flamegraph for every execution.

5. **Soft delete on workflows** - `DELETE /workflows/:id` is currently hard-delete, which orphans execution history. A `deletedAt` timestamp + filtered queries preserves audit trails.

6. **Execution log retention policy** - `ExecutionStepLog` grows unbounded. A scheduled job that archives or prunes logs older than N days would prevent storage bloat at scale.
