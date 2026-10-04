import { scrubText } from './scrub';

/**
 * Structured JSON logs without personal data (ADR 0009 §2). The API is closed on purpose: callers pass
 * a short message and a fixed set of typed fields — never request bodies, domain objects or users — so
 * nothing personal can be logged by accident. Every string is scrubbed again as a backstop.
 */
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  /** Stable action / event name, e.g. `platform.auth.sign_in`. */
  readonly action?: string;
  /** Permission code checked by defineAction. */
  readonly permission?: string;
  readonly correlationId?: string;
  /** Tenant UUID (allowed identifier). */
  readonly tenantId?: string;
  /** HTTP or upstream status code. */
  readonly status?: number;
  readonly outcome?: 'success' | 'failure' | 'denied';
  readonly durationMs?: number;
  /** Stable application error code (AppError / RFC 9457 `code`). */
  readonly errorCode?: string;
  /** Error class name only — never the message, which may contain input values. */
  readonly errorName?: string;
  /** Route pattern (e.g. `/[locale]/suite`), never the concrete URL. */
  readonly route?: string;
}

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export type LogWriter = (level: LogLevel, line: string) => void;

const FIELD_NAMES: Readonly<Record<keyof LogFields, string>> = {
  action: 'action',
  permission: 'permission',
  correlationId: 'correlation_id',
  tenantId: 'tenant_id',
  status: 'status',
  outcome: 'outcome',
  durationMs: 'duration_ms',
  errorCode: 'error_code',
  errorName: 'error_name',
  route: 'route',
};

/** Runtime environment value (dynamic access: never inlined at build time, see ADR 0010). */
function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === '' ? undefined : value;
}

/** Deployment-level fields on every line (ADR 0009 §1 common attributes). */
export function baseLogFields(service: string): Record<string, string> {
  const fields: Record<string, string> = { service };
  const env = readEnv('JADARAT_ENVIRONMENT') ?? readEnv('VERCEL_ENV') ?? readEnv('NODE_ENV');
  const deployment = readEnv('JADARAT_DEPLOYMENT');
  const version = readEnv('JADARAT_RELEASE') ?? readEnv('VERCEL_GIT_COMMIT_SHA');
  if (env) fields.env = env;
  if (deployment) fields.deployment = deployment;
  if (version) fields.version = version;
  return fields;
}

const defaultWriter: LogWriter = (level, line) => {
  (level === 'info' ? process.stdout : process.stderr).write(`${line}\n`);
};

/** Formats one log line (exported for tests). */
export function formatLogLine(
  level: LogLevel,
  message: string,
  fields: LogFields,
  base: Record<string, string>,
  now: Date = new Date(),
): string {
  const line: Record<string, string | number> = {
    time: now.toISOString(),
    level,
    msg: scrubText(message),
    ...base,
  };
  for (const [key, name] of Object.entries(FIELD_NAMES) as [keyof LogFields, string][]) {
    const value = fields[key];
    if (typeof value === 'string') line[name] = scrubText(value);
    else if (typeof value === 'number' && Number.isFinite(value)) line[name] = value;
  }
  return JSON.stringify(line);
}

export function createLogger(
  options: { readonly service?: string; readonly write?: LogWriter } = {},
): Logger {
  const service = options.service ?? readEnv('JADARAT_SERVICE') ?? 'suite-web';
  const write = options.write ?? defaultWriter;
  const emit =
    (level: LogLevel) =>
    (message: string, fields: LogFields = {}) => {
      write(level, formatLogLine(level, message, fields, baseLogFields(service)));
    };
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}

/** Process-wide logger for server code. */
export const log: Logger = createLogger();
