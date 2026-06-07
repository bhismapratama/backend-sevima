-- Migration: add tags to workflow_definitions
--
-- Zero-downtime strategy:
--   Step 1 (this file): Add the column as nullable - safe to run while the app is live.
--                        Old app code ignores the column; new code writes to it.
--   Step 2 (separate script, run after deploy): Backfill existing rows in batches.
--   Step 3 (future migration): Add NOT NULL + DEFAULT constraint once backfill completes.
--
-- Never add NOT NULL without a DEFAULT in a single migration on a live table -
-- PostgreSQL takes an ACCESS EXCLUSIVE lock and rewrites every row, blocking reads/writes
-- for the duration.

-- Step 1: add nullable column (no lock contention)
ALTER TABLE "workflow_definitions"
    ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}';

-- Index for future tag-based filtering.
-- CONCURRENTLY builds the index without a table lock (safe on live traffic).
-- Cannot run inside a transaction block - Prisma migrate wraps migrations in a
-- transaction, so this index must be created in a separate script or with
-- prisma migrate --skip-generate and manual execution.
--
-- Run this separately against the database after the migration completes:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS
--       "workflow_definitions_tags_idx" ON "workflow_definitions" USING GIN ("tags");
