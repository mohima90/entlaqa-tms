import { defineJadaratIntegrationConfig } from '@jadarat/config/vitest';
import { defineConfig } from 'vitest/config';

const base = defineJadaratIntegrationConfig();

// One file at a time: each file runs worker passes over the one shared queue, and a pass dispatches
// every pending event to its own subscribers only — two files at once would take each other's events.
export default defineConfig({ ...base, test: { ...base.test, fileParallelism: false } });
