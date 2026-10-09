import { type Socket, createConnection } from 'node:net';

/**
 * ClamAV daemon client (ADR 0006 §3.4, §8; T-M2-18): clamd's TCP protocol with null-terminated commands —
 * `zPING`, `zVERSION`, and `zINSTREAM`, which takes the bytes as chunks (4-byte big-endian length, data)
 * ended by a zero-length chunk, and answers `stream: OK`, `stream: <signature> FOUND` or `… ERROR`.
 * clamd runs next to the worker on an internal network (no TLS on that hop; self-hosted compose `scan`
 * network, staging: the job's own container). Nothing is written to disk.
 */
export interface ClamdOptions {
  readonly host: string;
  readonly port: number;
  /** Connecting (default 5 s). */
  readonly connectTimeoutMs?: number;
  /** No bytes moving in either direction (default 60 s): clamd is stuck or gone. */
  readonly idleTimeoutMs?: number;
}

/** clamd cannot be reached or stopped answering: the scan is tried again later (fail closed). */
export class ScannerUnavailableError extends Error {
  override readonly name = 'ScannerUnavailableError';
  readonly code = 'SCANNER_UNAVAILABLE';
}

/** clamd answered with an error for this stream (e.g. a limit): not a verdict. */
export class ScannerError extends Error {
  override readonly name = 'ScannerError';
  readonly code = 'SCANNER_ERROR';
}

export type ScanVerdict =
  | { readonly clean: true }
  | {
      readonly clean: false;
      /** The signature name, e.g. `Eicar-Test-Signature` (printable ASCII, ≤ 200 characters). */
      readonly finding: string;
    };

export interface ScannerVersion {
  /** e.g. `ClamAV 1.5.4`. */
  readonly engine: string;
  /** Signature database version, e.g. `28137`, with its build date. */
  readonly signatures: string;
  /** When the signatures were built (UTC); null when clamd did not say. */
  readonly signaturesDate: Date | null;
}

export interface ScanSession {
  /** Sends the next bytes (waits while clamd's socket is full). */
  write(chunk: Uint8Array): Promise<void>;
  /** Ends the stream and waits for the verdict. */
  finish(): Promise<ScanVerdict>;
  /** Abandons the scan (closes the connection). */
  abort(): void;
}

export interface Scanner {
  ping(): Promise<void>;
  version(): Promise<ScannerVersion>;
  /** Opens an INSTREAM scan; throws ScannerUnavailableError when clamd cannot be reached. */
  start(): Promise<ScanSession>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Mon Sep 28 06:24:12 2026` (clamd prints the build date in its own time zone: UTC in the image). */
export function parseClamDate(value: string): Date | null {
  const parts = value
    .trim()
    .split(' ')
    .filter((p) => p !== '');
  if (parts.length !== 5) return null;
  const [, month, day, time, year] = parts as [string, string, string, string, string];
  const monthIndex = MONTHS.indexOf(month);
  const [h, m, s] = time.split(':').map(Number);
  const date = new Date(
    Date.UTC(Number(year), monthIndex, Number(day), h ?? NaN, m ?? NaN, s ?? NaN),
  );
  return monthIndex < 0 || Number.isNaN(date.getTime()) ? null : date;
}

/** `ClamAV 1.5.4/28137/Mon Sep 28 06:24:12 2026` → engine, signatures, date. */
export function parseVersion(reply: string): ScannerVersion {
  const [engine = '', database = '', ...rest] = reply.trim().split('/');
  const date = rest.join('/');
  if (!/^ClamAV [0-9][0-9.]{0,20}$/.test(engine))
    throw new ScannerError('unexpected VERSION answer');
  const signatures = /^[0-9]{1,10}$/.test(database) ? database : 'unknown';
  return {
    engine,
    signatures: date === '' ? signatures : `${signatures} (${date.slice(0, 40)})`,
    signaturesDate: date === '' ? null : parseClamDate(date),
  };
}

/** The verdict of an INSTREAM answer (null-terminated `stream: …`). */
export function parseVerdict(reply: string): ScanVerdict {
  const text = reply.trim();
  if (text === 'stream: OK') return { clean: true };
  const found = /^stream: (.{1,200}) FOUND$/.exec(text);
  if (found?.[1]) {
    // Printable ASCII only (it is stored and logged).
    let finding = '';
    for (const char of found[1]) {
      const cp = char.codePointAt(0) ?? 0;
      finding += cp >= 0x20 && cp < 0x7f ? char : '?';
    }
    return { clean: false, finding };
  }
  throw new ScannerError('clamd could not scan the stream');
}

const MAX_REPLY = 4096;

export function createClamdScanner(options: ClamdOptions): Scanner {
  const connectTimeout = options.connectTimeoutMs ?? 5000;
  const idleTimeout = options.idleTimeoutMs ?? 60_000;

  /** A connection whose reply (until the null byte or close) is collected from the start. */
  function connect(): Promise<{ socket: Socket; reply: Promise<string> }> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: options.host, port: options.port });
      let settled = false;
      const timer = setTimeout(() => {
        socket.destroy();
        if (!settled) {
          settled = true;
          reject(new ScannerUnavailableError('clamd did not accept the connection in time'));
        }
      }, connectTimeout);
      let received = '';
      const reply = new Promise<string>((done, fail) => {
        socket.on('data', (data: Buffer) => {
          received += data.toString('latin1');
          const end = received.indexOf('\0');
          if (end >= 0) {
            done(received.slice(0, end));
            socket.end();
          } else if (received.length > MAX_REPLY) {
            fail(new ScannerError('clamd answered too much'));
            socket.destroy();
          }
        });
        socket.on('close', () => {
          // Without the terminator: clamd closed early; whatever it said is the answer.
          if (received.length > 0) done(received);
          else fail(new ScannerUnavailableError('clamd closed the connection without an answer'));
        });
        socket.on('error', () => {
          fail(new ScannerUnavailableError('clamd connection failed'));
        });
      });
      reply.catch(() => undefined);
      socket.setTimeout(idleTimeout, () => {
        socket.destroy(new Error('idle'));
      });
      socket.once('connect', () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve({ socket, reply });
        }
      });
      socket.once('error', () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(new ScannerUnavailableError('clamd is not reachable'));
        }
      });
    });
  }

  async function command(name: 'zPING' | 'zVERSION'): Promise<string> {
    const { socket, reply } = await connect();
    socket.write(`${name}\0`);
    return reply;
  }

  return {
    async ping() {
      if ((await command('zPING')).trim() !== 'PONG')
        throw new ScannerError('unexpected PING answer');
    },
    async version() {
      return parseVersion(await command('zVERSION'));
    },
    async start() {
      const { socket, reply } = await connect();
      let failed: Error | null = null;
      socket.on('error', (error) => {
        failed = error;
      });
      const send = (data: Uint8Array) =>
        new Promise<void>((resolve, reject) => {
          if (failed || socket.destroyed) {
            reject(new ScannerUnavailableError('clamd connection lost'));
            return;
          }
          if (socket.write(data)) resolve();
          else {
            const onDrain = () => {
              socket.off('close', onClose);
              resolve();
            };
            const onClose = () => {
              socket.off('drain', onDrain);
              reject(new ScannerUnavailableError('clamd connection lost'));
            };
            socket.once('drain', onDrain);
            socket.once('close', onClose);
          }
        });
      await send(Buffer.from('zINSTREAM\0', 'latin1'));
      /** clamd answered before the end of the stream (it stops reading, e.g. at a limit). */
      let answeredEarly = false;
      const earlyAnswer = () =>
        Promise.race([
          reply.then(
            () => true,
            () => false,
          ),
          new Promise<false>((resolve) => {
            setTimeout(() => {
              resolve(false);
            }, 2000).unref();
          }),
        ]);
      return {
        async write(chunk) {
          // Chunks of at most 1 MiB each (clamd reads a chunk at a time).
          for (let offset = 0; offset < chunk.length && !answeredEarly; offset += 1024 * 1024) {
            const part = chunk.subarray(offset, Math.min(chunk.length, offset + 1024 * 1024));
            const header = Buffer.alloc(4);
            header.writeUInt32BE(part.length, 0);
            try {
              await send(header);
              await send(part);
            } catch (error) {
              if (await earlyAnswer()) {
                answeredEarly = true;
                return;
              }
              throw error;
            }
          }
        },
        async finish() {
          if (!answeredEarly) {
            try {
              await send(Buffer.alloc(4));
            } catch (error) {
              if (!(await earlyAnswer())) throw error;
            }
          }
          return parseVerdict(await reply);
        },
        abort() {
          socket.destroy();
        },
      };
    },
  };
}
