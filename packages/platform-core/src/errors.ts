/**
 * Application error model shared by server actions, route handlers and jobs (ADR 0011 §3).
 *
 * - `code`: stable, SCREAMING_SNAKE, from a namespaced registry (platform codes below; modules declare
 *   theirs with defineErrorCodes(), e.g. `ENROLLMENT_CAPACITY_FULL`). Clients rely on the code.
 * - `status`: HTTP status (400 malformed, 401 unauthenticated, 403 missing permission, 404 out of scope
 *   or other tenant, 409 conflict, 412 If-Match, 422 validation, 429 rate limit, 5xx server).
 * - `messageKey` + `params`: next-intl key rendered in the active locale by the client. Params never
 *   contain secrets or personal data.
 * - `fieldErrors`: validation problems mapped onto form fields (paths and codes only, never input values).
 * - `expose`: whether the error is meant for the client. Non-exposed errors reach the client only as
 *   INTERNAL_ERROR with a correlation id (toClientError); no stack traces or SQL ever do.
 */
export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 412 | 422 | 429 | 500 | 503;

const ERROR_STATUSES: ReadonlySet<number> = new Set([
  400, 401, 403, 404, 409, 412, 422, 429, 500, 503,
]);

export type ErrorParams = Readonly<Record<string, string | number | boolean>>;

export interface FieldError {
  /** Dotted path of the offending input field, e.g. `endsAt` or `items.0.quantity`. */
  readonly path: string;
  /** Stable SCREAMING_SNAKE code of the field problem, e.g. `TOO_SMALL`, `BEFORE_START`. */
  readonly code: string;
  /** Optional next-intl key for a field-specific message. */
  readonly messageKey?: string;
  readonly params?: ErrorParams;
}

export interface AppError {
  readonly code: string;
  readonly status: ErrorStatus;
  readonly messageKey: string;
  readonly params?: ErrorParams;
  readonly fieldErrors?: readonly FieldError[];
  readonly expose: boolean;
  /** Set on INTERNAL_ERROR (and any error logged server-side) to correlate UI reports with logs. */
  readonly correlationId?: string;
}

export interface ErrorDefinition<C extends string = string> {
  readonly code: C;
  readonly status: ErrorStatus;
  readonly messageKey: string;
  readonly expose: boolean;
}

interface ErrorDefinitionInput {
  readonly status: ErrorStatus;
  readonly messageKey: string;
  /** Defaults to true for 4xx and false for 5xx. */
  readonly expose?: boolean;
}

export const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const MESSAGE_KEY_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/;

export class ErrorDefinitionError extends Error {
  override readonly name = 'ErrorDefinitionError';
}

/**
 * Declares error codes (platform or module registry). Validates SCREAMING_SNAKE codes, dotted
 * next-intl message keys and statuses; returns frozen definitions keyed by code.
 */
export function defineErrorCodes<const D extends Readonly<Record<string, ErrorDefinitionInput>>>(
  definitions: D,
): { readonly [K in keyof D & string]: ErrorDefinition<K> } {
  const out: Record<string, ErrorDefinition> = {};
  for (const [code, def] of Object.entries(definitions)) {
    if (!ERROR_CODE_PATTERN.test(code)) {
      throw new ErrorDefinitionError(`Error code "${code}" must be SCREAMING_SNAKE_CASE`);
    }
    if (!MESSAGE_KEY_PATTERN.test(def.messageKey)) {
      throw new ErrorDefinitionError(
        `Error "${code}" has an invalid messageKey "${def.messageKey}"`,
      );
    }
    if (!ERROR_STATUSES.has(def.status)) {
      throw new ErrorDefinitionError(
        `Error "${code}" has an unsupported status ${String(def.status)}`,
      );
    }
    out[code] = Object.freeze({
      code,
      status: def.status,
      messageKey: def.messageKey,
      expose: def.expose ?? def.status < 500,
    });
  }
  return Object.freeze(out) as { readonly [K in keyof D & string]: ErrorDefinition<K> };
}

/** Platform error registry (ADR 0011 §3). Message keys live in packages/platform-i18n/messages. */
export const PlatformErrors = defineErrorCodes({
  MALFORMED_REQUEST: { status: 400, messageKey: 'errors.malformedRequest' },
  UNAUTHENTICATED: { status: 401, messageKey: 'errors.unauthenticated' },
  STEP_UP_REQUIRED: { status: 401, messageKey: 'errors.stepUpRequired' },
  FORBIDDEN: { status: 403, messageKey: 'errors.forbidden' },
  NOT_FOUND: { status: 404, messageKey: 'errors.notFound' },
  CONFLICT_VERSION: { status: 409, messageKey: 'errors.conflictVersion' },
  PRECONDITION_FAILED: { status: 412, messageKey: 'errors.preconditionFailed' },
  VALIDATION_FAILED: { status: 422, messageKey: 'errors.validationFailed' },
  RATE_LIMITED: { status: 429, messageKey: 'errors.rateLimited' },
  INTERNAL_ERROR: { status: 500, messageKey: 'errors.internalError', expose: false },
  NOT_CONFIGURED: { status: 503, messageKey: 'errors.notConfigured', expose: true },
});

export type PlatformErrorCode = keyof typeof PlatformErrors;

export interface AppErrorOptions {
  readonly params?: ErrorParams;
  readonly fieldErrors?: readonly FieldError[];
  readonly correlationId?: string;
}

/** Creates an AppError from a platform code or a module's ErrorDefinition. */
export function appError(
  definition: PlatformErrorCode | ErrorDefinition,
  options: AppErrorOptions = {},
): AppError {
  const def = typeof definition === 'string' ? PlatformErrors[definition] : definition;
  return {
    code: def.code,
    status: def.status,
    messageKey: def.messageKey,
    expose: def.expose,
    ...(options.params ? { params: options.params } : {}),
    ...(options.fieldErrors && options.fieldErrors.length > 0
      ? { fieldErrors: options.fieldErrors }
      : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
  };
}

/** Random correlation id for logs ↔ UI/API error reports. */
export function newCorrelationId(): string {
  return globalThis.crypto.randomUUID();
}

/** INTERNAL_ERROR for unexpected failures: carries only the correlation id (shown as a reference). */
export function internalError(correlationId: string = newCorrelationId()): AppError {
  return appError('INTERNAL_ERROR', { correlationId, params: { correlationId } });
}

/**
 * What may leave the server: exposed errors unchanged; anything else becomes INTERNAL_ERROR with the
 * same (or a new) correlation id, dropping params and field errors.
 */
export function toClientError(error: AppError): AppError {
  return error.expose ? error : internalError(error.correlationId);
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.code === 'string' &&
    ERROR_CODE_PATTERN.test(c.code) &&
    typeof c.status === 'number' &&
    ERROR_STATUSES.has(c.status) &&
    typeof c.messageKey === 'string' &&
    typeof c.expose === 'boolean'
  );
}
