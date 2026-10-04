import { inspect } from 'node:util';
import { REDACTED, SAFE_MESSAGE_ERRORS, scrubText } from './scrub';

/**
 * Formats an Error for an operational log: class name, stable code and stack locations — the message
 * is replaced (it routinely embeds input values) unless the class is allow-listed.
 */
export function formatErrorForLog(error: Error): string {
  const code =
    'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{2,64}$/.test(error.code)
      ? ` [${error.code}]`
      : '';
  const message = SAFE_MESSAGE_ERRORS.has(error.name) ? scrubText(error.message) : REDACTED;
  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, 20)
    .map((line) => scrubText(line));
  return [`${error.name}${code}: ${message}`, ...frames].join('\n');
}

function formatArg(arg: unknown): unknown {
  if (typeof arg === 'string') return scrubText(arg);
  if (arg instanceof Error) return formatErrorForLog(arg);
  if (arg !== null && typeof arg === 'object') {
    return scrubText(inspect(arg, { depth: 3, breakLength: Infinity }));
  }
  return arg;
}

const INSTALLED = Symbol.for('jadarat.observability.consoleScrubbing');
const METHODS = ['error', 'warn', 'info', 'log', 'debug'] as const;

type ConsoleLike = Pick<Console, (typeof METHODS)[number]> & { [INSTALLED]?: true };

/**
 * Output we do not write ourselves — Next.js request errors (`⨯ Error: …`), SDK warnings — goes through
 * `console`. Wrapping it applies the same rules as the structured logger: strings scrubbed, errors
 * without their message, objects inspected (bounded depth) and scrubbed. Idempotent.
 */
export function installConsoleScrubbing(target: ConsoleLike = console): void {
  if (target[INSTALLED]) return;
  for (const method of METHODS) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      original(...args.map(formatArg));
    };
  }
  target[INSTALLED] = true;
}
