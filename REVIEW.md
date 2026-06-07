# Code Review

## Context

Reviewing `workflow-runner.ts` - a pull request that introduces async workflow execution with retry logic, submitted by a junior team member. Comments are written as I would leave them in a real PR review.

---

## Code Under Review

```typescript
// workflow-runner.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';

@Injectable()
export class WorkflowRunner {
  constructor(private prisma: PrismaService) {}

  async runAll() {
    const workflows = await this.prisma.workflowDefinition.findMany();

    for (const wf of workflows) {
      try {
        const result = eval(wf.dag.script);
        await this.prisma.execution.create({
          data: {
            workflowDefinitionId: wf.id,
            status: 'SUCCESS',
            result: JSON.stringify(result),
          },
        });
      } catch (e) {
        console.log('error: ' + e);
        fs.appendFileSync('/var/log/flowforge.log', e + '\n');
      }
    }
  }

  async retryFailed() {
    const failed = await this.prisma.execution.findMany({
      where: { status: 'FAILED' },
    });

    for (const exec of failed) {
      exec.retryCount++;
      if (exec.retryCount < 3) {
        await this.runWorkflow(exec.workflowDefinitionId);
      }
    }
  }

  async runWorkflow(id: string) {
    const wf: any = await this.prisma.workflowDefinition.findFirst({
      where: { id },
    });
    const result = eval(wf.dag.script);
    await this.prisma.execution.create({
      data: {
        workflowDefinitionId: id,
        status: result ? 'SUCCESS' : 'FAILED',
      },
    });
  }
}
```

---

## Review Comments

### [Critical] `eval(wf.dag.script)` - Remote Code Execution vulnerability

```typescript
const result = eval(wf.dag.script);
```

This executes arbitrary JavaScript from the database with the full privileges of the Node.js process. Any user who can write a workflow (EDITOR role and above) can read environment variables, exfiltrate secrets, write to the filesystem, or spawn child processes.

**Fix:** Run user scripts in a sandboxed context. We already have `ScriptExecutor` in `src/workflow/core/script-executor.ts` which wraps scripts in `new Function(...)` with a controlled input scope. Use that instead. For stronger isolation, run scripts in a `Worker` thread or a V8 isolate (`isolated-vm`).

---

### [Critical] `runAll()` fetches every workflow without tenant scoping

```typescript
const workflows = await this.prisma.workflowDefinition.findMany();
```

No `tenantId` filter means this method returns workflows for every tenant in the system and executes them all in the same call. This is both a data-isolation violation and a DoS vector - one slow tenant's workflows block all others.

**Fix:** Scope the query to the calling tenant, or better - remove `runAll()` entirely. Workflow execution should always be initiated per-workflow through `ExecutionService.triggerManual()`, which is already scoped correctly.

---

### [Critical] `retryFailed()` mutates the in-memory object but never persists `retryCount`

```typescript
exec.retryCount++;
if (exec.retryCount < 3) {
  await this.runWorkflow(exec.workflowDefinitionId);
}
```

`exec.retryCount++` modifies the local object but never writes back to the database. Every call to `retryFailed()` re-reads all FAILED executions with `retryCount = 0`, so the retry runs infinitely and the guard `< 3` is never effective.

**Fix:** Update `retryCount` in the database inside the condition, ideally in a transaction that also updates the execution status:

```typescript
await this.prisma.execution.update({
  where: { id: exec.id },
  data: { retryCount: { increment: 1 }, status: 'PENDING' },
});
```

---

### [High] Silent swallowing of errors in `runAll()`

```typescript
} catch (e) {
  console.log('error: ' + e);
  fs.appendFileSync('/var/log/flowforge.log', e + '\n');
}
```

Three problems:

1. `console.log` loses the stack trace. Use `console.error(e)` to preserve it, or better - pass the full error object to a structured logger.
2. `fs.appendFileSync` is a blocking call on the hot path of an async service. In a high-throughput scenario this stalls the event loop. Use a proper logger (Winston, Pino) with async transports.
3. `/var/log/flowforge.log` is a hardcoded absolute path that may not exist or be writable in the container. Configuration should come from environment or a logger factory.

---

### [High] `runWorkflow` re-creates an Execution record but doesn't mark the old one FAILED

```typescript
await this.prisma.execution.create({
  data: {
    workflowDefinitionId: id,
    status: result ? 'SUCCESS' : 'FAILED',
  },
});
```

Called from `retryFailed()`, this creates a _new_ execution row without ever updating the previous FAILED one. The old FAILED execution is never resolved, leading to unbounded growth of FAILED records that will be retried again on the next `retryFailed()` call.

**Fix:** Update the existing execution's status and `startedAt` rather than inserting a duplicate. If a fresh execution record is intentional for audit purposes, mark the old one `CANCELLED` first.

---

### [Medium] `wf: any` bypasses type safety

```typescript
const wf: any = await this.prisma.workflowDefinition.findFirst({ ... });
```

Using `any` defeats TypeScript's purpose here. `prisma.workflowDefinition.findFirst` already returns a fully typed result. Remove the annotation and let inference work. If you need access to a nested field, use Prisma's `include` or a typed `Select`.

Also: the result is accessed without a null guard - if `findFirst` returns `null` (workflow not found), `wf.dag.script` throws `TypeError: Cannot read properties of null`. Add a null check or use `findUniqueOrThrow`.

---

### [Low] `result ? 'SUCCESS' : 'FAILED'` conflates falsy output with failure

```typescript
status: result ? 'SUCCESS' : 'FAILED',
```

A workflow step that legitimately returns `0`, `false`, `""`, or `null` would be recorded as FAILED even though it succeeded. Step success/failure should be determined by whether the execution threw, not by the truthiness of the return value.

---

### [Low] Missing `tenantId` on Execution creation

```typescript
await this.prisma.execution.create({
  data: {
    workflowDefinitionId: id,
    status: ...,
  },
});
```

The `Execution` model requires `tenantId` for multi-tenant isolation. Creating an execution without it will either cause a DB constraint violation or silently associate the record with no tenant, making it invisible to all tenant-scoped queries.

---

## Summary

| Severity | Count | Theme                                                                                             |
| -------- | ----- | ------------------------------------------------------------------------------------------------- |
| Critical | 3     | Security (eval RCE), data isolation (no tenantId scope), correctness (retry logic never persists) |
| High     | 2     | Error handling, duplicate execution records                                                       |
| Medium   | 1     | Type safety + null safety                                                                         |
| Low      | 2     | Logic correctness, schema violation                                                               |

The `eval`-based RCE and missing tenant scoping are blockers - this cannot ship as-is. The retry logic bug means the feature is functionally broken even in a single-tenant environment. I'd recommend a full rewrite of `retryFailed` and `runWorkflow` using the existing `ExecutionService` rather than patching the current implementation.
