import { defineJadaratVitestConfig } from '@jadarat/config/vitest';
import { defineConfig } from 'vitest/config';

// main.ts only wires the process (signals, exit code) around the tested pieces.
export default defineConfig(defineJadaratVitestConfig({ coverageExclude: ['src/main.ts'] }));
