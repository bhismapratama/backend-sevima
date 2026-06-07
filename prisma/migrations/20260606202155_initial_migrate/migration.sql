-- CreateEnum
CREATE TYPE "WorkflowRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('MANUAL', 'CRON', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('HTTP_CALL', 'SCRIPT', 'DELAY', 'CONDITION');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable: tenants
CREATE TABLE "tenants" (
    "id"        TEXT         NOT NULL,
    "name"      TEXT         NOT NULL,
    "slug"      TEXT         NOT NULL,
    "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateTable: users
CREATE TABLE "users" (
    "id"           TEXT            NOT NULL,
    "tenantId"     TEXT            NOT NULL,
    "email"        TEXT            NOT NULL,
    "passwordHash" TEXT            NOT NULL,
    "role"         "WorkflowRole"  NOT NULL DEFAULT 'VIEWER',
    "createdAt"    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMPTZ     NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateTable: workflow_definitions
CREATE TABLE "workflow_definitions" (
    "id"             TEXT         NOT NULL,
    "tenantId"       TEXT         NOT NULL,
    "name"           TEXT         NOT NULL,
    "description"    TEXT,
    "currentVersion" INTEGER      NOT NULL DEFAULT 1,
    "createdAt"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "workflow_definitions_tenantId_idx" ON "workflow_definitions"("tenantId");

-- CreateTable: workflow_versions
CREATE TABLE "workflow_versions" (
    "id"                   TEXT         NOT NULL,
    "workflowDefinitionId" TEXT         NOT NULL,
    "version"              INTEGER      NOT NULL,
    "dag"                  JSONB        NOT NULL,
    "createdAt"            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "workflow_versions_workflowDefinitionId_version_key"
    ON "workflow_versions"("workflowDefinitionId", "version");
CREATE INDEX "workflow_versions_workflowDefinitionId_idx"
    ON "workflow_versions"("workflowDefinitionId");

-- CreateTable: workflow_triggers
CREATE TABLE "workflow_triggers" (
    "id"                   TEXT          NOT NULL,
    "workflowDefinitionId" TEXT          NOT NULL,
    "type"                 "TriggerType" NOT NULL,
    "cronExpression"       TEXT,
    "webhookSecret"        TEXT,
    "webhookPath"          TEXT,
    "isActive"             BOOLEAN       NOT NULL DEFAULT TRUE,
    "createdAt"            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    "updatedAt"            TIMESTAMPTZ   NOT NULL,

    CONSTRAINT "workflow_triggers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "workflow_triggers_webhookPath_key" ON "workflow_triggers"("webhookPath");
CREATE INDEX "workflow_triggers_workflowDefinitionId_idx"
    ON "workflow_triggers"("workflowDefinitionId");

-- CreateTable: webhook_nonces
CREATE TABLE "webhook_nonces" (
    "id"        TEXT        NOT NULL,
    "nonce"     TEXT        NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "webhook_nonces_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webhook_nonces_nonce_key" ON "webhook_nonces"("nonce");
CREATE INDEX "webhook_nonces_expiresAt_idx" ON "webhook_nonces"("expiresAt");

-- CreateTable: executions
CREATE TABLE "executions" (
    "id"                   TEXT              NOT NULL,
    "tenantId"             TEXT              NOT NULL,
    "workflowDefinitionId" TEXT              NOT NULL,
    "workflowVersionId"    TEXT              NOT NULL,
    "triggeredById"        TEXT,
    "status"               "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt"            TIMESTAMPTZ,
    "completedAt"          TIMESTAMPTZ,
    "durationMs"           INTEGER,
    "error"                TEXT,
    "createdAt"            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "executions_tenantId_createdAt_idx"
    ON "executions"("tenantId", "createdAt" DESC);
CREATE INDEX "executions_workflowDefinitionId_createdAt_idx"
    ON "executions"("workflowDefinitionId", "createdAt" DESC);

-- CreateTable: execution_step_logs
CREATE TABLE "execution_step_logs" (
    "id"          TEXT        NOT NULL,
    "executionId" TEXT        NOT NULL,
    "stepId"      TEXT        NOT NULL,
    "stepName"    TEXT        NOT NULL,
    "status"      "StepStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt"   TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "durationMs"  INTEGER,
    "attempt"     INTEGER     NOT NULL DEFAULT 1,
    "input"       JSONB,
    "output"      JSONB,
    "error"       TEXT,
    "logs"        TEXT[]      NOT NULL DEFAULT '{}',

    CONSTRAINT "execution_step_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "execution_step_logs_executionId_idx"
    ON "execution_step_logs"("executionId");
CREATE INDEX "execution_step_logs_executionId_stepId_idx"
    ON "execution_step_logs"("executionId", "stepId");

-- AddForeignKey constraints
ALTER TABLE "users"
    ADD CONSTRAINT "users_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_definitions"
    ADD CONSTRAINT "workflow_definitions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_versions"
    ADD CONSTRAINT "workflow_versions_workflowDefinitionId_fkey"
    FOREIGN KEY ("workflowDefinitionId") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_triggers"
    ADD CONSTRAINT "workflow_triggers_workflowDefinitionId_fkey"
    FOREIGN KEY ("workflowDefinitionId") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "executions"
    ADD CONSTRAINT "executions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "executions"
    ADD CONSTRAINT "executions_workflowDefinitionId_fkey"
    FOREIGN KEY ("workflowDefinitionId") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "executions"
    ADD CONSTRAINT "executions_workflowVersionId_fkey"
    FOREIGN KEY ("workflowVersionId") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "executions"
    ADD CONSTRAINT "executions_triggeredById_fkey"
    FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "execution_step_logs"
    ADD CONSTRAINT "execution_step_logs_executionId_fkey"
    FOREIGN KEY ("executionId") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
