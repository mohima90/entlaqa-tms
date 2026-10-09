import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXE, streamOf, workbook } from '../test-fixtures';
import { ScannerError, ScannerUnavailableError, type Scanner } from './clamd';
import { FILE_SCAN_BATCH, FILE_SCAN_TASK, createFileScanTask } from './scan';
import type { FileObjectStore } from './store';

const db = vi.hoisted(() => ({
  claimFileScan: vi.fn(),
  finishFileScan: vi.fn(),
  retryFileScan: vi.fn(),
  finishFileHousekeeping: vi.fn(),
  insertSystemAuditEvent: vi.fn(),
}));
vi.mock('@jadarat/platform-db/jobs', () => db);
const events = vi.hoisted(() => ({ emitEvent: vi.fn() }));
vi.mock('@jadarat/platform-db', () => ({
  FILE_EVENTS: {
    uploaded: 'com.entlaqa.platform.file.uploaded',
    scanned: 'com.entlaqa.platform.file.scanned',
  },
  emitEvent: events.emitEvent,
}));

const FILE = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const TENANT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NOW = Date.UTC(2026, 9, 9, 12);
const utf8 = (text: string) => new TextEncoder().encode(text);

const lease = (overrides: Record<string, unknown> = {}) => ({
  fileId: FILE,
  tenantId: TENANT,
  bucket: 'imports',
  objectKey: 'k',
  purpose: 'platform.user_import',
  declaredType: 'text/csv',
  reportedSize: null,
  maxBytes: 1000,
  allowedTypes: ['text/csv', XLSX],
  attempt: 1,
  ...overrides,
});

const tx = <T>(_actor: unknown, fn: (t: unknown) => Promise<T>) => fn({});

function fakeStore(objects: Record<string, Uint8Array[] | null | Error>) {
  const store = {
    read: vi.fn((_bucket: string, key: string) => {
      const object = objects[key];
      if (object instanceof Error) return Promise.reject(object);
      return Promise.resolve(object ? { body: streamOf(...object), size: null } : null);
    }),
    move: vi.fn(() => Promise.resolve('moved' as const)),
    remove: vi.fn(() => Promise.resolve()),
    write: vi.fn(() => Promise.resolve()),
  };
  return store satisfies FileObjectStore;
}

/** A scanner that finds `EVIL` in the stream; `signaturesDate` for the age check. */
function fakeScanner(
  options: { down?: boolean; signaturesDate?: Date | null; fail?: boolean } = {},
) {
  const sessions: { bytes: number; aborted: boolean }[] = [];
  const scanner: Scanner = {
    ping: () => Promise.resolve(),
    version: () =>
      options.down
        ? Promise.reject(new ScannerUnavailableError('down'))
        : Promise.resolve({
            engine: 'ClamAV 1.5.4',
            signatures: '28137',
            signaturesDate:
              options.signaturesDate === undefined
                ? new Date(NOW - 3_600_000)
                : options.signaturesDate,
          }),
    start: () => {
      if (options.down) return Promise.reject(new ScannerUnavailableError('down'));
      const seen: Uint8Array[] = [];
      const session = { bytes: 0, aborted: false };
      sessions.push(session);
      return Promise.resolve({
        write: (chunk: Uint8Array) => {
          seen.push(chunk);
          session.bytes += chunk.length;
          return Promise.resolve();
        },
        finish: () => {
          if (options.fail)
            return Promise.reject(new ScannerError('clamd could not scan the stream'));
          const text = Buffer.concat(seen).toString('latin1');
          if (text.includes('LIMIT')) {
            return Promise.resolve({
              clean: false as const,
              finding: 'Heuristics.Limits.Exceeded.MaxScanSize',
            });
          }
          return Promise.resolve(
            text.includes('EVIL')
              ? { clean: false as const, finding: 'Eicar-Test-Signature' }
              : { clean: true as const },
          );
        },
        abort: () => {
          session.aborted = true;
        },
      });
    },
  };
  return { scanner, sessions };
}

function task(store: FileObjectStore, scanner: Scanner, log = vi.fn()) {
  return {
    log,
    task: createFileScanTask({
      withPlatformTx: tx as never,
      withSystemTx: tx as never,
      store,
      scanner,
      log,
      now: () => NOW,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.finishFileScan.mockResolvedValue(true);
  db.retryFileScan.mockResolvedValue('waiting');
  db.finishFileHousekeeping.mockResolvedValue(true);
});

describe('file scan task', () => {
  it('is a platform task that stops when nothing waits', async () => {
    db.claimFileScan.mockResolvedValue(null);
    const { task: scan } = task(fakeStore({}), fakeScanner().scanner);
    expect(scan.name).toBe(FILE_SCAN_TASK);
    await expect(scan.run({ jobId: '1' })).resolves.toBe(false);
  });

  it('records a clean CSV with its detected type, size, hash and engine, and tells the module', async () => {
    const csv = utf8('email,name\nsara@example.com,سارة\n');
    db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
    const { task: scan, log } = task(
      fakeStore({ k: [csv.subarray(0, 5), csv.subarray(5)] }),
      fakeScanner().scanner,
    );
    await expect(scan.run({ jobId: '1' })).resolves.toBe(false);
    expect(db.finishFileScan).toHaveBeenCalledWith({}, FILE, {
      outcome: 'clean',
      detectedType: 'text/csv',
      size: csv.length,
      sha256: createHash('sha256').update(csv).digest('hex'),
      engine: 'ClamAV 1.5.4',
      signatures: '28137',
    });
    expect(events.emitEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        type: 'com.entlaqa.platform.file.scanned',
        subject: FILE,
        data: { purpose: 'platform.user_import', outcome: 'clean' },
      }),
    );
    expect(db.insertSystemAuditEvent).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('scanned: clean'));
    // The logs name the file by id only.
    expect(JSON.stringify(log.mock.calls)).not.toContain('sara');
  });

  it('accepts an XLSX by content and continues while files wait (batch)', async () => {
    db.claimFileScan.mockResolvedValue(lease());
    const { task: scan } = task(fakeStore({ k: [workbook()] }), fakeScanner().scanner);
    await expect(scan.run({ jobId: '1' })).resolves.toBe(true);
    expect(db.finishFileScan).toHaveBeenCalledTimes(FILE_SCAN_BATCH);
    expect(db.finishFileScan.mock.calls[0]?.[2]).toMatchObject({
      outcome: 'clean',
      detectedType: XLSX,
    });
  });

  it('infected: recorded with the finding, audited, quarantined, logged as a security event', async () => {
    db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
    const store = fakeStore({ k: [utf8('a,b\nEVIL\n')] });
    const { task: scan, log } = task(store, fakeScanner().scanner);
    await scan.run({ jobId: '1' });
    expect(db.finishFileScan.mock.calls[0]?.[2]).toMatchObject({
      outcome: 'infected',
      finding: 'Eicar-Test-Signature',
    });
    expect(db.insertSystemAuditEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ action: 'platform.file.infected', entityId: FILE }),
    );
    expect(store.move).toHaveBeenCalledWith('imports', 'k', 'quarantine');
    expect(db.finishFileHousekeeping).toHaveBeenCalledWith({}, FILE, 'quarantine');
    expect(log).toHaveBeenCalledWith(
      'warning',
      expect.stringMatching(/^security: file .* is infected/),
    );
  });

  it('rejects by content (renamed executable, macro workbook), size, emptiness and scan limits; removes the object', async () => {
    const cases: [Uint8Array[], Record<string, unknown>][] = [
      [
        [EXE],
        {
          outcome: 'rejected',
          reason: 'type_not_allowed',
          detectedType: 'application/x-msdownload',
        },
      ],
      [
        [workbook(true)],
        {
          outcome: 'rejected',
          reason: 'type_not_allowed',
          detectedType: 'application/vnd.ms-excel.sheet.macroenabled.12',
        },
      ],
      [
        [new Uint8Array(600), new Uint8Array(600)],
        { outcome: 'rejected', reason: 'too_large', size: 1200 },
      ],
      [[], { outcome: 'rejected', reason: 'empty', size: 0 }],
      [[utf8('a,b\nLIMIT\n')], { outcome: 'rejected', reason: 'unscannable' }],
      [
        [new Uint8Array([0xc7, 0xe1, 0x2c, 0x41])],
        { outcome: 'rejected', reason: 'type_not_allowed', detectedType: null },
      ],
    ];
    for (const [chunks, expected] of cases) {
      vi.clearAllMocks();
      db.finishFileScan.mockResolvedValue(true);
      db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
      const store = fakeStore({ k: chunks });
      const fake = fakeScanner();
      await task(store, fake.scanner).task.run({ jobId: '1' });
      expect(db.finishFileScan.mock.calls[0]?.[2]).toMatchObject(expected);
      expect(store.remove).toHaveBeenCalledWith('imports', 'k');
      expect(db.finishFileHousekeeping).toHaveBeenCalledWith({}, FILE, 'remove_object');
      expect(db.insertSystemAuditEvent).not.toHaveBeenCalled();
    }
  });

  it('fails closed when the scanner is down: the file waits and the pass stops', async () => {
    db.claimFileScan.mockResolvedValue(lease());
    const { task: scan, log } = task(
      fakeStore({ k: [utf8('a,b\n')] }),
      fakeScanner({ down: true }).scanner,
    );
    await expect(scan.run({ jobId: '1' })).resolves.toBe(false);
    expect(db.retryFileScan).toHaveBeenCalledWith({}, FILE, 'scanner');
    expect(db.finishFileScan).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warning', expect.stringContaining('SCANNER_UNAVAILABLE'));
    expect(log).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('malware scanner not available'),
    );
  });

  it('fails closed when Storage is down; a failure of the file itself counts towards error', async () => {
    // Storage down: the pass stops after this file (no further claim).
    db.claimFileScan.mockResolvedValueOnce(lease());
    const unavailable = Object.assign(new Error('x'), {
      code: 'STORAGE_UNREACHABLE',
      temporary: true,
    });
    await task(fakeStore({ k: unavailable }), fakeScanner().scanner).task.run({ jobId: '1' });
    expect(db.retryFileScan).toHaveBeenLastCalledWith({}, FILE, 'scanner');

    db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
    db.retryFileScan.mockResolvedValueOnce('error');
    const fake = fakeScanner({ fail: true });
    const { task: scan, log } = task(fakeStore({ k: [utf8('a,b\n')] }), fake.scanner);
    await expect(scan.run({ jobId: '2' })).resolves.toBe(false);
    expect(db.retryFileScan).toHaveBeenLastCalledWith({}, FILE, 'processing');
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('SCANNER_ERROR'));
  });

  it('a missing object is an error, never clean; the scanner is not even opened', async () => {
    db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
    const fake = fakeScanner();
    await task(fakeStore({ k: null }), fake.scanner).task.run({ jobId: '1' });
    expect(db.finishFileScan.mock.calls[0]?.[2]).toEqual({
      outcome: 'error',
      reason: 'object_missing',
    });
    expect(fake.sessions).toHaveLength(0);
  });

  it('a result that cannot be recorded waits for another attempt; a stale lease records nothing', async () => {
    db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
    db.finishFileScan.mockRejectedValueOnce(new Error('tenant suspended'));
    const store = fakeStore({ k: [utf8('a,b\n')] });
    const { task: scan, log } = task(store, fakeScanner().scanner);
    await scan.run({ jobId: '1' });
    expect(db.retryFileScan).toHaveBeenCalledWith({}, FILE, 'scanner');
    expect(log).toHaveBeenCalledWith('warning', expect.stringContaining('not recorded'));

    db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
    db.finishFileScan.mockResolvedValueOnce(false);
    const infectedStore = fakeStore({ k: [utf8('EVIL')] });
    await task(infectedStore, fakeScanner().scanner).task.run({ jobId: '2' });
    expect(events.emitEvent).not.toHaveBeenCalled();
    expect(infectedStore.move).not.toHaveBeenCalled();
  });

  it('postpones the Storage follow-up to housekeeping when it fails', async () => {
    db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
    const store = fakeStore({ k: [utf8('EVIL')] });
    store.move.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'STORAGE_HTTP_503' }));
    const { task: scan, log } = task(store, fakeScanner().scanner);
    await scan.run({ jobId: '1' });
    expect(db.finishFileHousekeeping).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('postponed to housekeeping (STORAGE_HTTP_503)'),
    );
  });

  it('reports stale signatures at most hourly', async () => {
    db.claimFileScan.mockResolvedValue(null);
    const stale = fakeScanner({ signaturesDate: new Date(NOW - 30 * 3_600_000) });
    const { task: scan, log } = task(fakeStore({}), stale.scanner);
    await scan.run({ jobId: '1' });
    await scan.run({ jobId: '2' });
    const warnings = log.mock.calls.filter(([, message]) =>
      String(message).includes('30 hours old'),
    );
    expect(warnings).toHaveLength(1);
    const undated = task(fakeStore({}), fakeScanner({ signaturesDate: null }).scanner);
    await undated.task.run({ jobId: '3' });
    expect(undated.log).not.toHaveBeenCalled();
  });
});
