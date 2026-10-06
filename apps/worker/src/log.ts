import type { WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import type { Logger } from '@jadarat/platform-observability';

/**
 * graphile-worker's log lines through the platform logger (structured JSON, scrubbed; ADR 0009 §2).
 * Debug lines are dropped; the runner already removed payloads and other details.
 */
export function workerLog(logger: Logger) {
  return (level: WorkerLogLevel, message: string): void => {
    if (level === 'error') logger.error(message, { action: 'worker' });
    else if (level === 'warning') logger.warn(message, { action: 'worker' });
    else if (level === 'info') logger.info(message, { action: 'worker' });
  };
}
