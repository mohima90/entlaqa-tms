import { readFileSync } from 'node:fs';
import { type AddressInfo, type Server, type Socket, createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAMD_MAX_SCAN_TIME_MS,
  CLAMD_VERDICT_TIMEOUT_MS,
  ScannerError,
  ScannerUnavailableError,
  createClamdScanner,
  parseClamDate,
  parseVerdict,
  parseVersion,
} from './clamd';

/**
 * A stand-in clamd: answers zPING / zVERSION, and for zINSTREAM collects the chunks until the zero-length
 * one, then answers what `verdict` says about the received bytes — after `verdictDelayMs` (clamd scans
 * silently first). `early`: answer (and close) as soon as this many bytes arrived, like clamd at its
 * StreamMaxLength.
 */
function fakeClamd(options: {
  verdict?: (data: Buffer) => string;
  verdictDelayMs?: number;
  early?: number;
  silent?: boolean;
  version?: string;
}) {
  const sockets: Socket[] = [];
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    let buffer = Buffer.alloc(0);
    let command: string | null = null;
    const received: Buffer[] = [];
    let total = 0;
    socket.on('error', () => undefined);
    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      if (command === null) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        command = buffer.subarray(0, end).toString('latin1');
        buffer = buffer.subarray(end + 1);
        if (options.silent) return;
        if (command === 'zPING') {
          socket.end('PONG\0');
          return;
        }
        if (command === 'zVERSION') {
          socket.end(`${options.version ?? 'ClamAV 1.5.4/28137/Fri Oct  9 06:24:12 2026'}\0`);
          return;
        }
      }
      if (command !== 'zINSTREAM') return;
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          const answer = `${(options.verdict ?? (() => 'stream: OK'))(Buffer.concat(received))}\0`;
          if (options.verdictDelayMs === undefined) socket.end(answer);
          else {
            setTimeout(() => {
              if (!socket.destroyed) socket.end(answer);
            }, options.verdictDelayMs);
          }
          return;
        }
        if (buffer.length < 4 + length) return;
        received.push(buffer.subarray(4, 4 + length));
        total += length;
        buffer = buffer.subarray(4 + length);
        if (options.early !== undefined && total >= options.early) {
          socket.end('stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND\0');
          socket.destroySoon();
          return;
        }
      }
    });
  });
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function scannerFor(
  options: Parameters<typeof fakeClamd>[0],
  idleTimeoutMs?: number,
  verdictTimeoutMs?: number,
) {
  const fake = await fakeClamd(options);
  close = fake.close;
  return createClamdScanner({
    host: '127.0.0.1',
    port: fake.port,
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
    ...(verdictTimeoutMs === undefined ? {} : { verdictTimeoutMs }),
  });
}

describe('clamd client', () => {
  it('pings and reads the version with the signatures date', async () => {
    const scanner = await scannerFor({});
    await expect(scanner.ping()).resolves.toBeUndefined();
    const version = await scanner.version();
    expect(version.engine).toBe('ClamAV 1.5.4');
    expect(version.signatures).toBe('28137 (Fri Oct  9 06:24:12 2026)');
    expect(version.signaturesDate?.toISOString()).toBe('2026-10-09T06:24:12.000Z');
  });

  it('streams the bytes in chunks and returns the verdict', async () => {
    const scanner = await scannerFor({
      verdict: (data) =>
        data.includes('EVIL') ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK',
    });
    const clean = await scanner.start();
    await clean.write(new TextEncoder().encode('a,b\n'));
    // Larger than one 1 MiB chunk: split.
    await clean.write(new Uint8Array(1024 * 1024 + 10));
    expect(await clean.finish()).toEqual({ clean: true });
    const infected = await scanner.start();
    await infected.write(new TextEncoder().encode('xxEVILxx'));
    expect(await infected.finish()).toEqual({ clean: false, finding: 'Eicar-Test-Signature' });
  });

  it('accepts an answer clamd sends before the end of the stream (its limits)', async () => {
    const scanner = await scannerFor({ early: 1024 * 1024 });
    const session = await scanner.start();
    for (let i = 0; i < 8; i += 1) await session.write(new Uint8Array(1024 * 1024));
    expect(await session.finish()).toEqual({
      clean: false,
      finding: 'Heuristics.Limits.Exceeded.MaxFileSize',
    });
  });

  it('fails closed: unreachable, silent or unexpected answers are never clean', async () => {
    const fake = await fakeClamd({});
    const port = fake.port;
    await fake.close();
    const gone = createClamdScanner({ host: '127.0.0.1', port, connectTimeoutMs: 1000 });
    await expect(gone.ping()).rejects.toBeInstanceOf(ScannerUnavailableError);
    await expect(gone.start()).rejects.toBeInstanceOf(ScannerUnavailableError);

    const silent = await scannerFor({ silent: true }, 200);
    await expect(silent.ping()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it('reports scan errors and odd answers as errors, not verdicts', async () => {
    const failing = await scannerFor({ verdict: () => "stream: Can't allocate memory ERROR" });
    const session = await failing.start();
    await session.write(new Uint8Array([1]));
    await expect(session.finish()).rejects.toBeInstanceOf(ScannerError);
    await close?.();
    const odd = await scannerFor({ version: 'something else' });
    await expect(odd.version()).rejects.toBeInstanceOf(ScannerError);
  });

  it('waits for the verdict longer than the idle limit (clamd scans silently), up to its own limit', async () => {
    // Silent for 400 ms after the stream: longer than the 150 ms idle limit, within the verdict limit.
    const slow = await scannerFor({ verdictDelayMs: 400 }, 150, 2000);
    const session = await slow.start();
    await session.write(new Uint8Array([1, 2, 3]));
    expect(await session.finish()).toEqual({ clean: true });
    await close?.();
    // Silent past the verdict limit: unavailable (never clean).
    const stuck = await scannerFor({ verdictDelayMs: 2000 }, 150, 300);
    const stuckSession = await stuck.start();
    await stuckSession.write(new Uint8Array([1]));
    await expect(stuckSession.finish()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it('waits longer for a verdict than clamd.conf lets clamd scan', () => {
    const conf = readFileSync(
      new URL('../../../../infra/docker/clamav/clamd.conf', import.meta.url),
      'utf8',
    );
    const maxScanTime = /^MaxScanTime (\d+)$/m.exec(conf)?.[1];
    expect(Number(maxScanTime)).toBe(CLAMD_MAX_SCAN_TIME_MS);
    expect(CLAMD_VERDICT_TIMEOUT_MS).toBeGreaterThan(CLAMD_MAX_SCAN_TIME_MS + 30_000);
  });

  it('can abandon a scan', async () => {
    const scanner = await scannerFor({});
    const session = await scanner.start();
    session.abort();
    await expect(session.write(new Uint8Array([1]))).rejects.toBeInstanceOf(
      ScannerUnavailableError,
    );
  });
});

describe('clamd answers', () => {
  it('parses verdicts', () => {
    expect(parseVerdict('stream: OK')).toEqual({ clean: true });
    expect(parseVerdict('stream: Win.Test.EICAR_HDB-1 FOUND')).toEqual({
      clean: false,
      finding: 'Win.Test.EICAR_HDB-1',
    });
    // Only printable ASCII is kept (stored and logged).
    expect(parseVerdict(`stream: Bad${String.fromCodePoint(0x1b)}Name FOUND`)).toEqual({
      clean: false,
      finding: 'Bad?Name',
    });
    expect(() => parseVerdict('stream: Size limit exceeded ERROR')).toThrow(ScannerError);
    expect(() => parseVerdict('')).toThrow(ScannerError);
  });

  it('parses versions and dates', () => {
    expect(parseVersion('ClamAV 1.5.4')).toEqual({
      engine: 'ClamAV 1.5.4',
      signatures: 'unknown',
      signaturesDate: null,
    });
    expect(parseVersion('ClamAV 1.5.4/abc/Mon Sep 28 06:24:12 2026').signatures).toBe(
      'unknown (Mon Sep 28 06:24:12 2026)',
    );
    expect(() => parseVersion('Evil 1.0/1/x')).toThrow(ScannerError);
    expect(parseClamDate('Mon Sep 28 06:24:12 2026')?.toISOString()).toBe(
      '2026-09-28T06:24:12.000Z',
    );
    expect(parseClamDate('Mon Foo 28 06:24:12 2026')).toBeNull();
    expect(parseClamDate('yesterday')).toBeNull();
    expect(parseClamDate('Mon Sep 28 xx 2026')).toBeNull();
  });
});
