# FlowForge - Infrastructure Design

## AWS Architecture

```
CloudFront + S3
  └─ serves the compiled React SPA (zero servers, global CDN)

Application Load Balancer (HTTPS, TLS termination)
  └─ forwards to ECS Fargate (API)
        ├─ api-service  (2+ tasks, 0.5 vCPU / 1 GB)
        └─ worker-service (BullMQ processor, scales on queue depth)

Amazon RDS PostgreSQL 16 (Multi-AZ)
  ├─ write primary - all mutations
  └─ read replica - dashboard / execution list queries

Amazon ElastiCache Redis 7
  ├─ BullMQ job queue (async workflow execution)
  └─ health-metrics cache + rate-limit counters

AWS Secrets Manager
  └─ JWT_SECRET, DATABASE_URL, ANTHROPIC_API_KEY (no secrets in env at deploy time)
```

## Service Choices

| Component | Service | Rationale |
|---|---|---|
| API / worker | ECS Fargate | Serverless containers - no EC2 patching, per-second billing |
| Database | RDS PostgreSQL Multi-AZ | Managed failover, automated backups, PITR |
| Cache / queue | ElastiCache Redis | Managed Redis; BullMQ requires Lua scripts unavailable on Valkey |
| Frontend | S3 + CloudFront | Static SPA - 50 ms TTFB globally, no servers to manage |
| Secrets | Secrets Manager | Rotation without redeploy; IAM task roles, no long-lived keys |

## Load Balancing & Auto-Scaling

- ALB health-checks `GET /api/health` every 10 s; unhealthy tasks are replaced automatically.
- ECS Application Auto Scaling: scale `api-service` on CPU > 60 % (min 2, max 10 tasks).
- `worker-service` scales on a custom CloudWatch metric derived from the BullMQ Redis list length (queue depth > 50 → add a task).
- A Redis `SET NX` distributed lock prevents duplicate cron-trigger firings across replicas.

## Secrets Management

IAM task roles grant each ECS task `secretsmanager:GetSecretValue` for its specific secret ARNs only. Secrets are injected as environment variables at container start via the ECS `secrets` field - they never appear in task-definition JSON or source control.

## Estimated Monthly Cost (AWS us-east-1, low traffic)

| Service | Config | $/month |
|---|---|---|
| ECS Fargate | 2 tasks × 0.5 vCPU / 1 GB | ~$18 |
| RDS PostgreSQL | db.t4g.small Multi-AZ | ~$50 |
| ElastiCache | cache.t4g.micro | ~$15 |
| CloudFront + S3 | 10 GB transfer | ~$5 |
| Secrets Manager | 3 secrets | ~$2 |
| **Total** | | **~$90/month** |
