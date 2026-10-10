/**
 * The worker's Storage access as the files jobs need it — implemented by @jadarat/platform-db/admin
 * `createStorageAdmin` (the secret key, worker only) and bound by apps/worker.
 */
export interface FileObjectStore {
  read(
    bucket: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<{ readonly body: ReadableStream<Uint8Array>; readonly size: number | null } | null>;
  move(bucket: string, key: string, toBucket: string): Promise<'moved' | 'missing'>;
  remove(bucket: string, key: string): Promise<void>;
  write(
    bucket: string,
    key: string,
    bytes: Uint8Array<ArrayBuffer>,
    contentType: string,
  ): Promise<void>;
}

/** A failure worth another attempt later (Storage or the scanner unavailable): the file is not at fault. */
export function isTemporary(error: unknown): boolean {
  if (error instanceof Error && error.name === 'ScannerUnavailableError') return true;
  return (error as { temporary?: unknown } | null)?.temporary === true;
}

/** A stable code for the logs (never a message: they may quote data). */
export function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Za-z0-9_]{2,64}$/.test(code)) return code;
  return error instanceof Error ? error.name : 'unknown';
}
