import {ExecutionContext} from '../interfaces';

const VAR_REGEX = /(?:\$)?\{\{([^}]+)\}\}/g;
const SINGLE_VAR_REGEX = /^(?:\$)?\{\{([^}]+)\}\}$/;

export function interpolate(template: string, ctx: ExecutionContext): string {
  return template.replace(VAR_REGEX, (_match: string, expr: string) => {
    const value = resolveExpression(expr.trim(), ctx) as
      | string
      | number
      | boolean
      | bigint
      | object
      | null
      | undefined;
    if (value == null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'bigint') return value.toString();
    return String(value);
  });
}

export function interpolateDeep(
  value: unknown,
  ctx: ExecutionContext,
): unknown {
  if (typeof value === 'string') {
    const single = value.match(SINGLE_VAR_REGEX);
    if (single) {
      const resolved = resolveExpression(single[1].trim(), ctx);
      return resolved !== undefined && resolved !== null ? resolved : '';
    }
    return interpolate(value, ctx);
  }
  if (Array.isArray(value)) return value.map((v) => interpolateDeep(v, ctx));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        interpolateDeep(v, ctx),
      ]),
    );
  }
  return value;
}

function resolveExpression(expr: string, ctx: ExecutionContext): unknown {
  const parts = expr.split('.');

  if (parts[0] === 'steps') {
    const stepId = parts[1];
    const stepResult = ctx.steps.get(stepId);
    if (!stepResult) return undefined;
    let cursor: unknown = stepResult;
    for (const part of parts.slice(1)) {
      if (cursor === null || cursor === undefined) return undefined;
      cursor = (cursor as Record<string, unknown>)[part];
    }
    return cursor;
  }

  if (parts[0] === 'globals') {
    let cursor: unknown = ctx.globals;
    for (const part of parts.slice(1)) {
      if (cursor === null || cursor === undefined) return undefined;
      cursor = (cursor as Record<string, unknown>)[part];
    }
    return cursor;
  }

  const stepResult = ctx.steps.get(parts[0]);
  if (stepResult) {
    let cursor: unknown = stepResult;
    for (const part of parts.slice(1)) {
      if (cursor === null || cursor === undefined) return undefined;
      cursor = (cursor as Record<string, unknown>)[part];
    }
    return cursor;
  }

  return undefined;
}
