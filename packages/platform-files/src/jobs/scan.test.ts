import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXE, streamOf, workbook } from '../test-fixtures';
import { ScannerError, ScannerUnavailableError, type Scanner } from './clamd';
import {
  FILE_SCAN_BATCH,
  FILE_SCAN_TASK,
  SIGNATURE_HARD_MAX_AGE_DAYS,
  createFileScanTask,
  signatureAge,
} from './scan';
import type { FileObjectStore } from './store';

const db = vi.hoisted(() => ({
  claimFileScan: vi.fn(),
  finishFileScan: vi.fn(),
  retryFileScan: vi.fn(),
  lockFileHousekeeping: vi.fn(),
  finishFileHousekeeping: vi.fn(),
  claimFileHousekeeping: vi.fn(),
  claimOrphanObjects: vi.fn(),
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

/**
 * A scanner that finds `EVIL` in the stream; `signaturesDate` for the age check; `drop`: the connection is
 * lost while streaming (`write`) or waiting for the verdict (`finish`); `pings`: whether PING answers.
 */
function fakeScanner(
  options: {
    down?: boolean;
    signaturesDate?: Date | null;
    fail?: boolean;
    drop?: 'write' | 'finish';
    pings?: boolean;
  } = {},
) {
  const sessions: { bytes: number; aborted: boolean }[] = [];
  const pinged = { count: 0 };
  const scanner: Scanner = {
    ping: () => {
      pinged.count += 1;
      return options.pings === false || options.down
        ? Promise.reject(new ScannerUnavailableError('down'))
        : Promise.resolve();
    },
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
          if (options.drop === 'write')
            return Promise.reject(new ScannerUnavailableError('clamd connection lost'));
          seen.push(chunk);
          session.bytes += chunk.length;
          return Promise.resolve();
        },
        finish: () => {
          if (options.fail)
            return Promise.reject(new ScannerError('clamd could not scan the stream'));
          if (options.drop === 'finish') {
            return Promise.reject(
              new ScannerUnavailableError('clamd closed the connection without an answer'),
            );
          }
          const text = Buffer.concat(seen).toString('latin1');
          if (text.includes('LIMIT')) {
            return Promise.resolve({
              clean: false as const,
              finding: 'Heuristics.Limits.Exceeded.MaxScanTime',
            });
          }
          if (text.includes('LOCKED')) {
            return Promise.resolve({ clean: false as const, finding: 'Heuristics.Encrypted.Zip' });
          }
          if (text.includes('ENCRYPTEDISH')) {
            // Not the exact prefix: any other finding is malware.
            return Promise.resolve({ clean: false as const, finding: 'Heuristics.EncryptedX.Zip' });
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
  return { scanner, sessions, pinged };
}

function task(
  store: FileObjectStore,
  scanner: Scanner,
  log = vi.fn(),
  extra: { maxSignatureAgeDays?: number; now?: () => number } = {},
) {
  return {
    log,
    task: createFileScanTask({
      withPlatformTx: tx as never,
      withSystemTx: tx as never,
      store,
      scanner,
      log,
      now: () => NOW,
      ...extra,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.finishFileScan.mockResolvedValue(true);
  db.retryFileScan.mockResolvedValue('waiting');
  db.lockFileHousekeeping.mockResolvedValue(true);
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
      {
        action: 'platform.file.infected',
        entityType: 'file',
        entityId: FILE,
        data: {
          purpose: 'platform.user_import',
          finding: 'Eicar-Test-Signature',
          engine: 'ClamAV 1.5.4',
          severity: 'high',
        },
      },
    );
    // The quarantine move: locked and re-checked first, then moved, then recorded.
    expect(db.lockFileHousekeeping).toHaveBeenCalledWith({}, FILE, 'quarantine');
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
      expect(db.lockFileHousekeeping).toHaveBeenCalledWith({}, FILE, 'remove_object');
      expect(store.remove).toHaveBeenCalledWith('imports', 'k');
      expect(db.finishFileHousekeeping).toHaveBeenCalledWith({}, FILE, 'remove_object');
      expect(db.insertSystemAuditEvent).not.toHaveBeenCalled();
    }
  });

  it('encrypted and unscannable: rejected (not malware), object removed, low-severity audit event', async () => {
    const cases: [string, string, string][] = [
      ['a,b\nLOCKED\n', 'encrypted', 'Heuristics.Encrypted.Zip'],
      ['a,b\nLIMIT\n', 'unscannable', 'Heuristics.Limits.Exceeded.MaxScanTime'],
    ];
    for (const [content, reason, finding] of cases) {
      vi.clearAllMocks();
      db.finishFileScan.mockResolvedValue(true);
      db.lockFileHousekeeping.mockResolvedValue(true);
      db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
      const store = fakeStore({ k: [utf8(content)] });
      const { task: scan, log } = task(store, fakeScanner().scanner);
      await scan.run({ jobId: '1' });
      expect(db.finishFileScan.mock.calls[0]?.[2]).toMatchObject({
        outcome: 'rejected',
        reason,
        finding,
      });
      expect(db.insertSystemAuditEvent).toHaveBeenCalledWith(
        {},
        {
          action: 'platform.file.unscannable',
          entityType: 'file',
          entityId: FILE,
          data: {
            purpose: 'platform.user_import',
            reason,
            finding,
            engine: 'ClamAV 1.5.4',
            severity: 'low',
          },
        },
      );
      expect(store.remove).toHaveBeenCalledWith('imports', 'k');
      expect(store.move).not.toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain('security:');
    }
  });

  it('any other finding — even one that merely looks like the encrypted prefix — is malware', async () => {
    db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
    const store = fakeStore({ k: [utf8('ENCRYPTEDISH')] });
    await task(store, fakeScanner().scanner).task.run({ jobId: '1' });
    expect(db.finishFileScan.mock.calls[0]?.[2]).toMatchObject({
      outcome: 'infected',
      finding: 'Heuristics.EncryptedX.Zip',
    });
    expect(store.move).toHaveBeenCalledWith('imports', 'k', 'quarantine');
  });

  it('a removal no longer due (legal hold set meanwhile) is left alone', async () => {
    db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
    db.lockFileHousekeeping.mockResolvedValueOnce(false);
    const store = fakeStore({ k: [EXE] });
    await task(store, fakeScanner().scanner).task.run({ jobId: '1' });
    expect(store.remove).not.toHaveBeenCalled();
    expect(db.finishFileHousekeeping).not.toHaveBeenCalled();
  });

  it('fails closed when the scanner is down: the file waits and the pass stops', async () => {
    db.claimFileScan.mockResolvedValue(lease());
    const { task: scan, log } = task(
      fakeStore({ k: [utf8('a,b\n')] }),
      fakeScanner({ down: true }).scanner,
    );
    await expect(scan.run({ jobId: '1' })).resolves.toBe(false);
    expect(db.claimFileScan).toHaveBeenCalledTimes(1);
    expect(db.retryFileScan).toHaveBeenCalledWith({}, FILE, 'scanner');
    expect(db.finishFileScan).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warning', expect.stringContaining('SCANNER_UNAVAILABLE'));
    expect(log).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('malware scanner not available'),
    );
  });

  it('a file still without a verdict 24 hours after its upload gives up: logged as an error', async () => {
    db.claimFileScan.mockResolvedValue(lease());
    db.retryFileScan.mockResolvedValueOnce('error');
    const { task: scan, log } = task(
      fakeStore({ k: [utf8('a,b\n')] }),
      fakeScanner({ down: true }).scanner,
    );
    await expect(scan.run({ jobId: '1' })).resolves.toBe(false);
    expect(db.retryFileScan).toHaveBeenCalledWith({}, FILE, 'scanner');
    expect(log).toHaveBeenCalledWith(
      'error',
      `file ${FILE}: no scan verdict (SCANNER_UNAVAILABLE); error (scanner_unavailable)`,
    );
  });

  it('clamd drops a stream but answers a PING: the file is at fault (counted), the pass goes on', async () => {
    for (const drop of ['write', 'finish'] as const) {
      vi.clearAllMocks();
      db.retryFileScan.mockResolvedValue('waiting');
      db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
      const fake = fakeScanner({ drop });
      const { task: scan, log } = task(fakeStore({ k: [utf8('a,b\n')] }), fake.scanner);
      await expect(scan.run({ jobId: '1' })).resolves.toBe(false);
      expect(fake.pinged.count).toBe(1);
      expect(db.retryFileScan).toHaveBeenCalledWith({}, FILE, 'processing');
      // The pass did not stop at this file: it asked for the next one.
      expect(db.claimFileScan).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('SCAN_FAILED'));
    }
  });

  it('clamd drops a stream and does not answer a PING: a suspected crash on the file — counted, the pass stops', async () => {
    for (const drop of ['write', 'finish'] as const) {
      vi.clearAllMocks();
      db.retryFileScan.mockResolvedValue('waiting');
      db.claimFileScan.mockResolvedValue(lease());
      const fake = fakeScanner({ drop, pings: false });
      const { task: scan, log } = task(fakeStore({ k: [utf8('a,b\n')] }), fake.scanner);
      await expect(scan.run({ jobId: '1' })).resolves.toBe(false);
      expect(fake.pinged.count).toBe(1);
      expect(db.retryFileScan).toHaveBeenCalledWith({}, FILE, 'crash');
      expect(db.claimFileScan).toHaveBeenCalledTimes(1);
      expect(db.insertSystemAuditEvent).not.toHaveBeenCalled();
      // A crash is an error for the operators even before the file gives up.
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('SCANNER_CRASHED'));
    }
  });

  it('the third crash on the same file: error (scanner_crashed), high-severity security event', async () => {
    db.claimFileScan.mockResolvedValue(lease());
    db.retryFileScan.mockResolvedValueOnce('crashed');
    const fake = fakeScanner({ drop: 'finish', pings: false });
    const { task: scan, log } = task(fakeStore({ k: [utf8('a,b\n')] }), fake.scanner);
    await expect(scan.run({ jobId: '1' })).resolves.toBe(false);
    expect(db.insertSystemAuditEvent).toHaveBeenCalledWith(
      {},
      {
        action: 'platform.file.scanner_crashed',
        entityType: 'file',
        entityId: FILE,
        data: { purpose: 'platform.user_import', crashes: 3, severity: 'high' },
      },
    );
    expect(log).toHaveBeenCalledWith(
      'error',
      `security: file ${FILE} (platform.user_import) crashed the malware scanner 3 times; error (scanner_crashed)`,
    );
    // The event cannot be written (e.g. the organization was suspended): the log line remains.
    vi.clearAllMocks();
    db.claimFileScan.mockResolvedValue(lease());
    db.retryFileScan.mockResolvedValueOnce('crashed');
    db.insertSystemAuditEvent.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: '23502' }),
    );
    const second = task(
      fakeStore({ k: [utf8('a,b\n')] }),
      fakeScanner({ drop: 'write', pings: false }).scanner,
    );
    await expect(second.task.run({ jobId: '2' })).resolves.toBe(false);
    expect(second.log).toHaveBeenCalledWith(
      'warning',
      `file ${FILE}: the scanner-crash security event was not recorded (23502)`,
    );
  });

  it('a Storage stream that breaks off is Storage unavailable, not the file', async () => {
    db.claimFileScan.mockResolvedValue(lease());
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError('terminated'));
      },
    });
    const store = fakeStore({});
    store.read.mockResolvedValueOnce({ body: broken, size: null });
    await expect(task(store, fakeScanner().scanner).task.run({ jobId: '1' })).resolves.toBe(false);
    expect(db.retryFileScan).toHaveBeenCalledWith({}, FILE, 'scanner');
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

  it('reports stale signatures at most hourly, and still scans', async () => {
    db.claimFileScan.mockResolvedValue(null);
    const stale = fakeScanner({ signaturesDate: new Date(NOW - 30 * 3_600_000) });
    const { task: scan, log } = task(fakeStore({}), stale.scanner);
    await scan.run({ jobId: '1' });
    await scan.run({ jobId: '2' });
    const warnings = log.mock.calls.filter(([, message]) =>
      String(message).includes('30 hours old'),
    );
    expect(warnings).toHaveLength(1);
    expect(db.claimFileScan).toHaveBeenCalledTimes(2);
  });

  it('fails closed above the hard signature age, or with an undated database: nothing is claimed, an error hourly', async () => {
    for (const signaturesDate of [new Date(NOW - (7 * 24 + 1) * 3_600_000), null]) {
      vi.clearAllMocks();
      db.claimFileScan.mockResolvedValue(lease());
      let clock = NOW;
      const { task: scan, log } = task(
        fakeStore({ k: [utf8('a,b\n')] }),
        fakeScanner({ signaturesDate }).scanner,
        vi.fn(),
        { now: () => clock },
      );
      await expect(scan.run({ jobId: '1' })).resolves.toBe(false);
      await expect(scan.run({ jobId: '2' })).resolves.toBe(false);
      expect(db.claimFileScan).not.toHaveBeenCalled();
      expect(db.finishFileScan).not.toHaveBeenCalled();
      const errors = log.mock.calls.filter(([level]) => level === 'error');
      expect(errors).toHaveLength(1);
      expect(String(errors[0]?.[1])).toContain('NOTHING is scanned');
      clock += 61 * 60_000;
      await scan.run({ jobId: '3' });
      expect(log.mock.calls.filter(([level]) => level === 'error')).toHaveLength(2);
    }
  });

  it('a test installation may raise the hard limit (pinned signatures)', async () => {
    db.claimFileScan.mockResolvedValueOnce(lease()).mockResolvedValueOnce(null);
    const old = fakeScanner({ signaturesDate: new Date(NOW - 30 * 24 * 3_600_000) });
    await task(fakeStore({ k: [utf8('a,b\n')] }), old.scanner, vi.fn(), {
      maxSignatureAgeDays: 365,
    }).task.run({ jobId: '1' });
    expect(db.finishFileScan.mock.calls[0]?.[2]).toMatchObject({ outcome: 'clean' });
  });
});

describe('signatureAge', () => {
  const version = (signaturesDate: Date | null) => ({
    engine: 'ClamAV 1.5.4',
    signatures: '28137',
    signaturesDate,
  });
  it('tells fresh, stale, too old and unknown apart', () => {
    expect(signatureAge(version(new Date(NOW - 3_600_000)), NOW)).toEqual({
      age: 'fresh',
      hours: 1,
    });
    expect(signatureAge(version(new Date(NOW - 25 * 3_600_000)), NOW).age).toBe('stale');
    expect(
      signatureAge(version(new Date(NOW - SIGNATURE_HARD_MAX_AGE_DAYS * 24 * 3_600_000)), NOW).age,
    ).toBe('stale');
    expect(
      signatureAge(version(new Date(NOW - (SIGNATURE_HARD_MAX_AGE_DAYS * 24 + 1) * 3_600_000)), NOW)
        .age,
    ).toBe('too_old');
    expect(signatureAge(version(null), NOW)).toEqual({ age: 'unknown', hours: null });
    expect(signatureAge(version(new Date(NOW - 10 * 24 * 3_600_000)), NOW, 30).age).toBe('stale');
  });
});
