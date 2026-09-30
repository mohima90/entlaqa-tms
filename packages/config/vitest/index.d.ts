import type { ViteUserConfig } from 'vitest/config';

export interface JadaratVitestOptions {
  coverageInclude?: string[];
  coverageExclude?: string[];
  thresholds?: Partial<Record<'lines' | 'statements' | 'functions' | 'branches', number>>;
  environment?: string;
}

type WithTest = ViteUserConfig & {
  test: NonNullable<ViteUserConfig['test']> & { exclude: string[] };
};

export function defineJadaratVitestConfig(options?: JadaratVitestOptions): WithTest;
export function defineJadaratIntegrationConfig(): ViteUserConfig;
