import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FILE_HOUSEKEEPING_BATCH,
  FILE_HOUSEKEEPING_TASK,
  createFileHousekeepingTask,
} from './housekeeping';
import { codeOf, isTemporary } from './store';

const db = vi.hoisted(() => ({
  claimFileHousekeeping: vi.fn(),
  finishFileHousekeeping: vi.fn(),
}));
vi.mock('@jadarat/platform-db/jobs', () => db);

const TENANT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const tx = <T>(_actor: unknown, fn: (t: unknown) => Promise<T>) => fn({});
const item = (id: string, action: string) => ({
  fileId: id,
  tenantId: TENANT,
  bucket: 'imports',
  objectKey: `key-${id}`,
  action,
});

function setup() {
  const store = {
    read: vi.fn(),
    move: vi.fn(() => Promise.resolve('moved' as const)),
    remove: vi.fn(() => Promise.resolve()),
    write: vi.fn(),
  };
  const log = vi.fn();
  const task = createFileHousekeepingTask({ withPlatformTx: tx as never, store, log });
  return { store, log, task };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.finishFileHousekeeping.mockResolvedValue(true);
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
    expect(db.claimFileHousekeeping).toHaveBeenCalledWith({}, FILE_HOUSEKEEPING_BATCH);
    expect(store.move).toHaveBeenCalledWith('imports', 'key-1', 'quarantine');
    expect(store.remove).toHaveBeenCalledWith('imports', 'key-2');
    expect(store.remove).toHaveBeenCalledWith('imports', 'key-3');
    expect(db.finishFileHousekeeping.mock.calls.map((call: unknown[]) => call.slice(1))).toEqual([
      ['1', 'quarantine'],
      ['2', 'remove_object'],
      ['3', 'purge'],
    ]);
    expect(log).toHaveBeenCalledWith('info', 'file housekeeping: 3 done');
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
