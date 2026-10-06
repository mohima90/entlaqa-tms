import type { Logger } from '@jadarat/platform-observability';
import { describe, expect, it, vi } from 'vitest';
import { workerLog } from './log';
import { SUBSCRIBERS } from './subscribers';

describe('workerLog', () => {
  it('maps graphile-worker levels to the platform logger and drops debug lines', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
    const log = workerLog(logger);
    log('error', 'failed');
    log('warning', 'slow');
    log('info', 'started');
    log('debug', 'details');
    expect(logger.error).toHaveBeenCalledWith('failed', { action: 'worker' });
    expect(logger.warn).toHaveBeenCalledWith('slow', { action: 'worker' });
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});

describe('SUBSCRIBERS', () => {
  it('form a valid registry', async () => {
    const { createSubscriberRegistry } = await import('@jadarat/platform-jobs/jobs');
    expect(() => createSubscriberRegistry(SUBSCRIBERS)).not.toThrow();
  });
});
