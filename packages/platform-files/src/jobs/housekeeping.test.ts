import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FILE_HOUSEKEEPING_BATCH,
  FILE_HOUSEKEEPING_TASK,
  ORPHAN_SWEEP_BATCH,
  ORPHAN_SWEEP_INTERVAL_MS,
  createFileHousekeepingTask,
} from './housekeeping';
import { codeOf, isTemporary } from './store';

const db = vi.hoisted(() => ({
  claimFileHousekeeping: vi.fn(),
  lockFileHousekeeping: vi.fn(),
  finishFileHousekeeping: vi.fn(),
  claimOrphanObjects: vi.fn(),
}));
vi.mock('@jadarat/platform-db/jobs', () => db);

const TENANT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
/** Each transaction gets its own handle, so the tests can tell which calls shared one. */
let txCount = 0;
const tx = <T>(_actor: unknown, fn: (t: unknown) => Promise<T>) => {
  txCount += 1;
  return fn({ tx: txCount });
};
const item = (id: string, action: string) => ({
  fileId: id,
  tenantId: TENANT,
  bucket: 'imports',
  objectKey: `key-${id}`,
  action,
});

function setup(now: () => number = () => 0) {
  const store = {
    read: vi.fn(),
    move: vi.fn(() => Promise.resolve('moved' as const)),
    remove: vi.fn(() => Promise.resolve()),
    write: vi.fn(),
  };
  const log = vi.fn();
  const task = createFileHousekeepingTask({ withPlatformTx: tx as never, store, log, now });
  return { store, log, task };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.lockFileHousekeeping.mockResolvedValue(true);
  db.finishFileHousekeeping.mockResolvedValue(true);
  db.claimOrphanObjects.mockResolvedValue([]);
});

describe('file housekeeping task', () => {
  it('quarantines, removes and purges, recording each after its Storage work', async () => {
    db.claimFileHousekeeping.mockResolvedValue([
      item('1', 'quarantine'),
      item('2', 'remove_object'),
      item('3', 'purge'),
    ]);
    const { store, log, task } = setup();
    expect(task.name).toBe(FILE_HOUSEKEEPING_TASK);
    await expect(task.run({ jobId: 'j' })).resolves.toBe(false);
    expect(db.claimFileHousekeeping).toHaveBeenCalledWith(
      expect.anything(),
      FILE_HOUSEKEEPING_BATCH,
    );
    expect(store.move).toHaveBeenCalledWith('imports', 'key-1', 'quarantine');
    expect(store.remove).toHaveBeenCalledWith('imports', 'key-2');
    expect(store.remove).toHaveBeenCalledWith('imports', 'key-3');
    expect(db.finishFileHousekeeping.mock.calls.map((call: unknown[]) => call.slice(1))).toEqual([
      ['1', 'quarantine'],
      ['2', 'remove_object'],
      ['3', 'purge'],
    ]);
    // Lock, Storage work and record: in ONE transaction per file (the row lock covers the removal).
    for (let i = 0; i < 3; i += 1) {
      expect(db.lockFileHousekeeping.mock.calls[i]?.[0]).toEqual(
        db.finishFileHousekeeping.mock.calls[i]?.[0],
      );
    }
    expect(db.lockFileHousekeeping.mock.invocationCallOrder[0]).toBeLessThan(
      store.move.mock.invocationCallOrder[0] ?? 0,
    );
    expect(log).toHaveBeenCalledWith('info', 'file housekeeping: 3 done');
  });

  it('leaves a file alone when its action is no longer due under the lock (legal hold, use)', async () => {
    db.claimFileHousekeeping.mockResolvedValue([item('1', 'purge'), item('2', 'remove_object')]);
    db.lockFileHousekeeping.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { store, log, task } = setup();
    await task.run({ jobId: 'j' });
    expect(store.remove).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledWith('imports', 'key-2');
    expect(db.finishFileHousekeeping).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('info', 'file housekeeping: 1 done');
  });

  it('leaves a failed item for its next lease and continues; a full batch asks for another pass', async () => {
    db.claimFileHousekeeping.mockResolvedValue(
      Array.from({ length: FILE_HOUSEKEEPING_BATCH }, (_, i) => item(String(i), 'purge')),
    );
    const { store, log, task } = setup();
    store.remove.mockRejectedValueOnce(
      Object.assign(new Error('Storage said: secret detail'), { code: 'STORAGE_HTTP_503' }),
    );
    await expect(task.run({ jobId: 'j' })).resolves.toBe(true);
    expect(db.finishFileHousekeeping).toHaveBeenCalledTimes(FILE_HOUSEKEEPING_BATCH - 1);
    expect(log).toHaveBeenCalledWith(
      'warning',
      'file 0: purge postponed (STORAGE_HTTP_503); tried again later',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret detail');
  });

  it('is quiet when nothing is due', async () => {
    db.claimFileHousekeeping.mockResolvedValue([]);
    const { log, task } = setup();
    await expect(task.run({ jobId: 'j' })).resolves.toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it('removes orphan objects at most hourly, and sweeps on while full batches come back', async () => {
    db.claimFileHousekeeping.mockResolvedValue([]);
    let clock = 0;
    const { store, log, task } = setup(() => clock);
    db.claimOrphanObjects.mockResolvedValueOnce([
      { bucket: 'generated', objectKey: 'orphan-1' },
      { bucket: 'imports', objectKey: 'orphan-2' },
    ]);
    await expect(task.run({ jobId: 'j' })).resolves.toBe(false);
    expect(db.claimOrphanObjects).toHaveBeenCalledWith(expect.anything(), ORPHAN_SWEEP_BATCH);
    expect(store.remove.mock.calls).toEqual([
      ['generated', 'orphan-1'],
      ['imports', 'orphan-2'],
    ]);
    expect(log).toHaveBeenCalledWith('info', 'file housekeeping: 2 orphan objects removed');
    // Within the hour: no sweep.
    clock += ORPHAN_SWEEP_INTERVAL_MS - 1;
    await task.run({ jobId: 'j' });
    expect(db.claimOrphanObjects).toHaveBeenCalledTimes(1);
    // An hour later, a full batch: another pass is asked for, and it sweeps again at once.
    clock += 1;
    db.claimOrphanObjects.mockResolvedValueOnce(
      Array.from({ length: ORPHAN_SWEEP_BATCH }, (_, i) => ({
        bucket: 'imports',
        objectKey: `o-${String(i)}`,
      })),
    );
    await expect(task.run({ jobId: 'j' })).resolves.toBe(true);
    await task.run({ jobId: 'j' });
    expect(db.claimOrphanObjects).toHaveBeenCalledTimes(3);
  });

  it('an orphan that cannot be removed is logged by bucket only; a failing sweep waits', async () => {
    db.claimFileHousekeeping.mockResolvedValue([]);
    const { store, log, task } = setup();
    db.claimOrphanObjects.mockResolvedValueOnce([{ bucket: 'imports', objectKey: 'secret-key' }]);
    store.remove.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'STORAGE_HTTP_503' }));
    await task.run({ jobId: 'j' });
    expect(log).toHaveBeenCalledWith(
      'warning',
      'file housekeeping: an orphan object in imports was not removed (STORAGE_HTTP_503)',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-key');
    const second = setup();
    db.claimOrphanObjects.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '57014' }));
    await expect(second.task.run({ jobId: 'j' })).resolves.toBe(false);
    expect(second.log).toHaveBeenCalledWith(
      'warning',
      'file housekeeping: orphan sweep postponed (57014)',
    );
  });
});

describe('store helpers', () => {
  it('tells temporary failures and gives log-safe codes', () => {
    const scannerDown = new Error('x');
    scannerDown.name = 'ScannerUnavailableError';
    expect(isTemporary(scannerDown)).toBe(true);
    expect(isTemporary({ temporary: true })).toBe(true);
    expect(isTemporary(new Error('x'))).toBe(false);
    expect(isTemporary(null)).toBe(false);
    expect(codeOf({ code: 'STORAGE_HTTP_500' })).toBe('STORAGE_HTTP_500');
    expect(codeOf({ code: 'has spaces and data' })).toBe('unknown');
    expect(codeOf(new TypeError('x'))).toBe('TypeError');
    expect(codeOf(undefined)).toBe('unknown');
  });
});
