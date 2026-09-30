/** Server-side environment access. Values are read lazily so the app builds without them. */
export function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}
