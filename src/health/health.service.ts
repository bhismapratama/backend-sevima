import {Inject, Injectable, Logger} from '@nestjs/common';
import {PrismaService} from 'infra/database/prisma.service';
import {REDIS_CLIENT} from 'infra/redis/redis.module';
import type Redis from 'ioredis';

const CACHE_TTL_SECONDS = 60;
const LOCK_TTL_SECONDS = 10;
const LOCK_POLL_MS = 50;
const LOCK_TIMEOUT_MS = 5_000;

export interface HourlyBucket {
  hour: string;
  success: number;
  failed: number;
  avgMs: number;
}

export interface StatusCounts {
  PENDING: number;
  RUNNING: number;
  SUCCESS: number;
  FAILED: number;
  TIMEOUT: number;
  CANCELLED: number;
}

export interface HealthMetrics {
  activeExecutions: number;
  successRate: number;
  failureRate: number;
  avgExecutionTimeMs: number;
  hourlyStats: HourlyBucket[];
  statusCounts: StatusCounts;
}

interface HourlyRow {
  hour_bucket: Date;
  success: bigint;
  failed: bigint;
  total_with_duration: bigint;
  sum_ms: number | null;
}

interface StatusCountRow {
  status: string;
  count: bigint;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getMetrics(tenantId: string): Promise<HealthMetrics> {
    const cacheKey = `health:metrics:${tenantId}`;
    const lockKey = `health:lock:${tenantId}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as HealthMetrics;
    }

    const lockAcquired = await this.redis.set(
      lockKey,
      '1',
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );

    if (!lockAcquired) {
      return this.waitForCache(cacheKey, lockKey, tenantId);
    }

    try {
      const metrics = await this.computeMetrics(tenantId);
      await this.redis.setex(
        cacheKey,
        CACHE_TTL_SECONDS,
        JSON.stringify(metrics),
      );
      return metrics;
    } finally {
      await this.redis.del(lockKey);
    }
  }

  private async waitForCache(
    cacheKey: string,
    lockKey: string,
    tenantId: string,
  ): Promise<HealthMetrics> {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, LOCK_POLL_MS));

      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as HealthMetrics;

      const lockExists = await this.redis.exists(lockKey);
      if (!lockExists) {
        const retryLock = await this.redis.set(
          lockKey,
          '1',
          'EX',
          LOCK_TTL_SECONDS,
          'NX',
        );
        if (!retryLock) continue;

        try {
          const metrics = await this.computeMetrics(tenantId);
          await this.redis.setex(
            cacheKey,
            CACHE_TTL_SECONDS,
            JSON.stringify(metrics),
          );
          return metrics;
        } finally {
          await this.redis.del(lockKey);
        }
      }
    }

    this.logger.warn(
      `Cache lock timeout exceeded for tenant ${tenantId}, computing directly`,
    );
    return this.computeMetrics(tenantId);
  }

  private async computeMetrics(tenantId: string): Promise<HealthMetrics> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [activeExecutions, hourlyRows, statusCountRows] = await Promise.all([
      this.prisma.execution.count({
        where: {tenantId, status: {in: ['PENDING', 'RUNNING']}},
      }),

      this.prisma.$queryRaw<HourlyRow[]>`
        SELECT
          DATE_TRUNC('hour', "createdAt")                            AS hour_bucket,
          COUNT(*) FILTER (WHERE status = 'SUCCESS')                 AS success,
          COUNT(*) FILTER (WHERE status = 'FAILED')                  AS failed,
          COUNT(*) FILTER (WHERE "durationMs" IS NOT NULL)           AS total_with_duration,
          SUM("durationMs")   FILTER (WHERE "durationMs" IS NOT NULL) AS sum_ms
        FROM executions
        WHERE "tenantId" = ${tenantId}
          AND "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('hour', "createdAt")
        ORDER BY hour_bucket
      `,

      this.prisma.$queryRaw<StatusCountRow[]>`
        SELECT status, COUNT(*) AS count
        FROM executions
        WHERE "tenantId" = ${tenantId}
          AND "createdAt" >= ${since}
        GROUP BY status
      `,
    ]);

    const hourlyMap = new Map<string, HourlyBucket>();
    for (let h = 23; h >= 0; h--) {
      const d = new Date(Date.now() - h * 60 * 60 * 1000);
      const key = `${d.getUTCHours().toString().padStart(2, '0')}:00`;
      hourlyMap.set(key, {hour: key, success: 0, failed: 0, avgMs: 0});
    }

    let totalSuccess = 0;
    let totalFailed = 0;
    let totalWithDuration = 0;
    let totalSumMs = 0;

    for (const row of hourlyRows) {
      const key = `${row.hour_bucket.getUTCHours().toString().padStart(2, '0')}:00`;
      const s = Number(row.success);
      const f = Number(row.failed);
      const withDur = Number(row.total_with_duration);
      const sumMs = Number(row.sum_ms ?? 0);

      totalSuccess += s;
      totalFailed += f;
      totalWithDuration += withDur;
      totalSumMs += sumMs;

      const bucket = hourlyMap.get(key);
      if (bucket) {
        bucket.success = s;
        bucket.failed = f;
        bucket.avgMs = withDur > 0 ? Math.round(sumMs / withDur) : 0;
      }
    }

    const total = totalSuccess + totalFailed;
    const successRate =
      total === 0 ? 0 : Math.round((totalSuccess / total) * 100);
    const failureRate = total === 0 ? 0 : 100 - successRate;
    const avgExecutionTimeMs =
      totalWithDuration === 0 ? 0 : Math.round(totalSumMs / totalWithDuration);

    const statusCounts: StatusCounts = {
      PENDING: 0,
      RUNNING: 0,
      SUCCESS: 0,
      FAILED: 0,
      TIMEOUT: 0,
      CANCELLED: 0,
    };
    for (const row of statusCountRows) {
      const key = row.status as keyof StatusCounts;
      if (key in statusCounts) statusCounts[key] = Number(row.count);
    }

    return {
      activeExecutions,
      successRate,
      failureRate,
      avgExecutionTimeMs,
      hourlyStats: Array.from(hourlyMap.values()),
      statusCounts,
    };
  }
}
