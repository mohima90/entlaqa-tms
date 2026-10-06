/**
 * Minimal safe HTML for e-mail templates: every interpolated value is escaped unless it is already
 * SafeHtml produced by `markup` (not named `html`: formatters rewrite templates tagged `html`). Templates are code (ADR 0008 §3); tenant-editable text (LiquidJS,
 * sandboxed) comes later.
 */
const SAFE = Symbol('safe-html');

export interface SafeHtml {
  readonly [SAFE]: true;
  readonly value: string;
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

function isSafe(value: SafeHtml | readonly SafeHtml[]): value is SafeHtml {
  return SAFE in value;
}

type Interpolation = string | number | SafeHtml | readonly SafeHtml[];

function piece(value: Interpolation): string {
  if (typeof value === 'string') return escapeHtml(value);
  if (typeof value === 'number') return escapeHtml(String(value));
  if (isSafe(value)) return value.value;
  return value.map((v) => v.value).join('');
}

export function markup(strings: TemplateStringsArray, ...values: Interpolation[]): SafeHtml {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    out += piece(value) + (strings[i + 1] ?? '');
  });
  return { [SAFE]: true, value: out };
}

/**
 * Links in messages: https only (http only for a local development host). The string is output as
 * given, so it must not carry what the URL parser would strip or encode (spaces, line breaks, other
 * control or invisible formatting characters).
 */
export function isSafeLink(url: string): boolean {
  if (/[\s\p{Cc}\p{Cf}]/u.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === 'https:') return true;
  return (
    parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  );
}
