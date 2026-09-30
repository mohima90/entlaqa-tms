import { describe, expect, it } from 'vitest';
import {
  ErrorDefinitionError,
  PlatformErrors,
  appError,
  defineErrorCodes,
  internalError,
  isAppError,
  toClientError,
} from './errors';

describe('AppError (ADR 0011 §3)', () => {
  it('uses SCREAMING_SNAKE codes with the ADR status mapping', () => {
    expect(appError('FORBIDDEN').status).toBe(403);
    expect(appError('NOT_FOUND').status).toBe(404);
    expect(appError('UNAUTHENTICATED').status).toBe(401);
    expect(appError('STEP_UP_REQUIRED').status).toBe(401);
    expect(appError('CONFLICT_VERSION').status).toBe(409);
    expect(appError('PRECONDITION_FAILED').status).toBe(412);
    expect(appError('VALIDATION_FAILED').status).toBe(422);
    expect(appError('RATE_LIMITED').status).toBe(429);
    expect(appError('INTERNAL_ERROR').status).toBe(500);
    expect(appError('NOT_CONFIGURED').status).toBe(503);
    for (const def of Object.values(PlatformErrors)) {
      expect(def.code).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
      expect(def.messageKey).toMatch(/^errors\.[a-zA-Z]+$/);
    }
  });

  it('carries messageKey, params, fieldErrors and expose; omits empty optional fields', () => {
    expect(appError('VALIDATION_FAILED')).toEqual({
      code: 'VALIDATION_FAILED',
      status: 422,
      messageKey: 'errors.validationFailed',
      expose: true,
    });
    expect(appError('VALIDATION_FAILED', { fieldErrors: [] })).not.toHaveProperty('fieldErrors');
    const withDetails = appError('RATE_LIMITED', {
      params: { retryAfterSeconds: 30 },
      fieldErrors: [{ path: 'email', code: 'TOO_MANY' }],
    });
    expect(withDetails.params).toEqual({ retryAfterSeconds: 30 });
    expect(withDetails.fieldErrors).toEqual([{ path: 'email', code: 'TOO_MANY' }]);
  });

  it('unexpected errors are INTERNAL_ERROR, not exposed, with a correlation id', () => {
    const e = internalError();
    expect(e.code).toBe('INTERNAL_ERROR');
    expect(e.expose).toBe(false);
    expect(e.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.params).toEqual({ correlationId: e.correlationId });
    expect(internalError('abc').correlationId).toBe('abc');
    expect(internalError().correlationId).not.toBe(e.correlationId);
  });

  it('toClientError passes exposed errors and hides everything else behind INTERNAL_ERROR', () => {
    const exposed = appError('NOT_FOUND');
    expect(toClientError(exposed)).toBe(exposed);
    const secretDef = defineErrorCodes({
      LMS_UPSTREAM_BROKEN: { status: 500, messageKey: 'tms.errors.lmsUpstream' },
    }).LMS_UPSTREAM_BROKEN;
    const hidden = appError(secretDef, { params: { host: 'internal.lms' }, correlationId: 'c-1' });
    expect(hidden.expose).toBe(false);
    expect(toClientError(hidden)).toEqual(internalError('c-1'));
    expect(toClientError(appError(secretDef)).code).toBe('INTERNAL_ERROR');
  });

  it('modules declare their own codes (namespaced registry) and bad definitions are rejected', () => {
    const tms = defineErrorCodes({
      ENROLLMENT_CAPACITY_FULL: { status: 409, messageKey: 'tms.errors.enrollmentCapacityFull' },
    });
    const e = appError(tms.ENROLLMENT_CAPACITY_FULL, { params: { sessionCode: 'TMS-1' } });
    expect(e).toMatchObject({ code: 'ENROLLMENT_CAPACITY_FULL', status: 409, expose: true });
    expect(() =>
      defineErrorCodes({ capacityFull: { status: 409, messageKey: 'tms.errors.x' } }),
    ).toThrow(ErrorDefinitionError);
    expect(() => defineErrorCodes({ CAPACITY_FULL: { status: 409, messageKey: 'Full!' } })).toThrow(
      /messageKey/,
    );
    expect(() =>
      defineErrorCodes({ CAPACITY_FULL: { status: 418 as 409, messageKey: 'tms.errors.x' } }),
    ).toThrow(/status/);
  });

  it('recognises app errors', () => {
    expect(isAppError(appError('INTERNAL_ERROR'))).toBe(true);
    expect(isAppError({ code: 'forbidden', status: 403, messageKey: 'x.y', expose: true })).toBe(
      false,
    );
    expect(isAppError({ code: 'FORBIDDEN', status: 418, messageKey: 'x.y', expose: true })).toBe(
      false,
    );
    expect(isAppError({ code: 'FORBIDDEN', status: 403, messageKey: 'x.y' })).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError('FORBIDDEN')).toBe(false);
  });
});
