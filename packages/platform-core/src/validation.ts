import type { z } from 'zod';
import { type AppError, type ErrorParams, type FieldError, appError } from './errors';
import { type Result, err, ok } from './result';

/** zod issue code (snake_case) → stable field-error code (SCREAMING_SNAKE, ADR 0011 §3). */
function fieldCode(issueCode: string): string {
  return issueCode.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

/** Bounds from size issues only — never the rejected input value itself. */
function boundParams(issue: z.core.$ZodIssue): ErrorParams | undefined {
  if (issue.code === 'too_small') return { minimum: Number(issue.minimum) };
  if (issue.code === 'too_big') return { maximum: Number(issue.maximum) };
  return undefined;
}

/**
 * Validates untrusted input with a zod schema. Failures are VALIDATION_FAILED (422) with field errors
 * carrying paths, codes and bounds only (no input values).
 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): Result<z.output<S>, AppError> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  const fieldErrors: FieldError[] = parsed.error.issues.map((issue) => {
    const params = boundParams(issue);
    return {
      path: issue.path.map(String).join('.'),
      code: fieldCode(issue.code),
      ...(params ? { params } : {}),
    };
  });
  return err(appError('VALIDATION_FAILED', { fieldErrors }));
}
