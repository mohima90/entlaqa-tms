/**
 * Fixture tests for the dependency-cruiser rules (packages/config/dependency-cruiser/rules.cjs).
 * Each test builds a tiny throw-away repository (same top-level layout as this one: apps/, packages/,
 * modules/, node_modules/) in a temp directory and cruises it with the REAL rule set, so a rule that
 * silently stops matching (wrong anchor, excluded path) fails here.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cruise } from 'dependency-cruiser';
import { afterAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const config = require('../packages/config/dependency-cruiser/rules.cjs');

const roots = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Writes `files` ({ relativePath: content }) into a fresh fixture repository. */
function fixtureRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'jadarat-depcruise-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

/** Cruises the fixture with the real rules; returns the violations as `rule: from → to`. */
async function violations(root) {
  // Same entry points as `pnpm check:deps` (those present in the fixture).
  const entry = ['apps', 'packages', 'modules'].filter((dir) => existsSync(join(root, dir)));
  // The fixture has no tsconfig: drop the repository's tsConfig option.
  const options = { ...config.options };
  delete options.tsConfig;
  const result = await cruise(entry, {
    ...options,
    baseDir: root,
    validate: true,
    ruleSet: { forbidden: config.forbidden },
  });
  return result.output.summary.violations.map((v) => `${v.rule.name}: ${v.from} → ${v.to}`);
}

const platformDb = {
  'packages/platform-db/package.json': JSON.stringify({ name: '@jadarat/platform-db' }),
  'packages/platform-db/src/admin/index.ts': 'export const withAdminTx = 1;\n',
  'packages/platform-db/src/jobs/index.ts': 'export const withSystemTx = 1;\n',
};

describe('admin client / withSystemTx import rules (S2: exemptions anchored to real roots)', () => {
  it('rejects a Next.js route page under [locale]/admin/ or [locale]/jobs/ importing them', async () => {
    const root = fixtureRepo({
      ...platformDb,
      'apps/suite/package.json': JSON.stringify({ name: '@jadarat/suite' }),
      'apps/suite/src/app/[locale]/admin/page.tsx':
        "import { withAdminTx } from '../../../../../../packages/platform-db/src/admin/index';\nexport default withAdminTx;\n",
      'apps/suite/src/app/[locale]/jobs/page.tsx':
        "import { withSystemTx } from '../../../../../../packages/platform-db/src/jobs/index';\nexport default withSystemTx;\n",
    });
    const found = await violations(root);
    expect(found).toContain(
      'admin-client-only-in-jobs-or-admin: apps/suite/src/app/[locale]/admin/page.tsx → packages/platform-db/src/admin/index.ts',
    );
    expect(found).toContain(
      'no-admin-or-jobs-db-in-suite-app: apps/suite/src/app/[locale]/admin/page.tsx → packages/platform-db/src/admin/index.ts',
    );
    expect(found).toContain(
      'jobs-db-only-in-jobs: apps/suite/src/app/[locale]/jobs/page.tsx → packages/platform-db/src/jobs/index.ts',
    );
    expect(found).toContain(
      'no-admin-or-jobs-db-in-suite-app: apps/suite/src/app/[locale]/jobs/page.tsx → packages/platform-db/src/jobs/index.ts',
    );
  });

  it('rejects admin/ or jobs/ folders that are not directly under a package or module src/', async () => {
    const root = fixtureRepo({
      ...platformDb,
      'modules/tms/package.json': JSON.stringify({ name: '@jadarat/tms' }),
      'modules/tms/src/ui/admin/panel.ts':
        "import { withAdminTx } from '../../../../../packages/platform-db/src/admin/index';\nexport const x = withAdminTx;\n",
      'modules/tms/src/admin/jobs/helper.ts':
        "import { withSystemTx } from '../../../../../packages/platform-db/src/jobs/index';\nexport const y = withSystemTx;\n",
    });
    const found = await violations(root);
    expect(found).toContain(
      'admin-client-only-in-jobs-or-admin: modules/tms/src/ui/admin/panel.ts → packages/platform-db/src/admin/index.ts',
    );
    expect(found).toContain(
      'jobs-db-only-in-jobs: modules/tms/src/admin/jobs/helper.ts → packages/platform-db/src/jobs/index.ts',
    );
  });

  it('allows the real roots: <package|module>/src/jobs|admin/ and apps/worker/', async () => {
    const root = fixtureRepo({
      ...platformDb,
      'modules/tms/package.json': JSON.stringify({ name: '@jadarat/tms' }),
      'modules/tms/src/jobs/reminders.ts':
        "import { withSystemTx } from '../../../../packages/platform-db/src/jobs/index';\nimport { withAdminTx } from '../../../../packages/platform-db/src/admin/index';\nexport const z = [withSystemTx, withAdminTx];\n",
      'packages/platform-tenancy/package.json': JSON.stringify({
        name: '@jadarat/platform-tenancy',
      }),
      'packages/platform-tenancy/src/admin/provision.ts':
        "import { withAdminTx } from '../../../platform-db/src/admin/index';\nexport const p = withAdminTx;\n",
      'apps/worker/package.json': JSON.stringify({ name: '@jadarat/worker' }),
      'apps/worker/src/main.ts':
        "import { withSystemTx } from '../../../packages/platform-db/src/jobs/index';\nexport const w = withSystemTx;\n",
    });
    const found = (await violations(root)).filter((v) =>
      /^(admin-client-only-in-jobs-or-admin|jobs-db-only-in-jobs|no-admin-or-jobs-db-in-suite-app):/.test(
        v,
      ),
    );
    expect(found).toEqual([]);
  });
});

describe('admin/jobs code cannot be laundered through re-exports (security re-review)', () => {
  it('rejects a module re-exporting the admin client that the suite app then imports', async () => {
    const root = fixtureRepo({
      ...platformDb,
      'modules/tms/package.json': JSON.stringify({ name: '@jadarat/tms' }),
      'modules/tms/src/admin/bridge.ts':
        "export { withAdminTx } from '../../../../packages/platform-db/src/admin/index';\n",
      'modules/tms/src/index.ts': "export { withAdminTx } from './admin/bridge';\n",
      'modules/tms/src/actions/laundered.ts':
        "import { withAdminTx } from '../admin/bridge';\nexport const l = withAdminTx;\n",
      'apps/suite/package.json': JSON.stringify({ name: '@jadarat/suite' }),
      'apps/suite/src/app/[locale]/page.tsx':
        "import { withAdminTx } from '../../../../../modules/tms/src/index';\nexport default withAdminTx;\n",
    });
    const found = await violations(root);
    expect(found).toContain(
      'admin-jobs-folders-are-private: modules/tms/src/index.ts → modules/tms/src/admin/bridge.ts',
    );
    expect(found).toContain(
      'admin-jobs-folders-are-private: modules/tms/src/actions/laundered.ts → modules/tms/src/admin/bridge.ts',
    );
    expect(
      found.some((v) =>
        v.startsWith('no-admin-or-jobs-reachable-from-suite: apps/suite/src/app/[locale]/page.tsx'),
      ),
    ).toBe(true);
  });

  it('still allows admin code to import other admin/jobs code', async () => {
    const root = fixtureRepo({
      ...platformDb,
      'modules/tms/package.json': JSON.stringify({ name: '@jadarat/tms' }),
      'modules/tms/src/admin/a.ts': 'export const a = 1;\n',
      'modules/tms/src/jobs/b.ts': "import { a } from '../admin/a';\nexport const b = a;\n",
    });
    const found = (await violations(root)).filter((v) =>
      v.startsWith('admin-jobs-folders-are-private'),
    );
    expect(found).toEqual([]);
  });
});

describe('no Auth admin client on the request path (T-M2-07, security review H1)', () => {
  const ADMIN_RULES =
    /^(admin-client-only-in-jobs-or-admin|admin-jobs-folders-are-private|no-admin-or-jobs-db-in-suite-app|no-admin-or-jobs-reachable-from-suite|platform-db-admin-only-from-admin-or-jobs):/;
  const base = {
    ...platformDb,
    'packages/platform-identity/package.json': JSON.stringify({
      name: '@jadarat/platform-identity',
    }),
    'apps/suite/package.json': JSON.stringify({ name: '@jadarat/suite' }),
  };
  const adminViolations = async (root) =>
    (await violations(root)).filter((v) => ADMIN_RULES.test(v));

  it('rejects the invitation accept action, form and page reaching the admin client in any way', async () => {
    const root = fixtureRepo({
      ...base,
      // The former exception: an identity module creating Auth users with the secret key.
      'packages/platform-identity/src/invitation-admin/create-user.ts':
        "import { createServiceRoleSupabaseClient } from '../../../platform-db/src/admin/index';\nexport const createInvitedUser = createServiceRoleSupabaseClient;\n",
      'apps/suite/src/auth/invitations.ts':
        "import { createInvitedUser } from '../../../../packages/platform-identity/src/invitation-admin/create-user';\nexport const acceptInvitationAction = createInvitedUser;\n",
      'apps/suite/src/components/invite/accept-invitation.tsx':
        "import { acceptInvitationAction } from '../../auth/invitations';\nexport const Form = acceptInvitationAction;\n",
      'apps/suite/src/app/[locale]/invite/accept/page.tsx':
        "import { Form } from '../../../../components/invite/accept-invitation';\nexport default Form;\n",
    });
    const found = await adminViolations(root);
    expect(found).toContain(
      'admin-client-only-in-jobs-or-admin: packages/platform-identity/src/invitation-admin/create-user.ts → packages/platform-db/src/admin/index.ts',
    );
    for (const from of [
      'apps/suite/src/auth/invitations.ts',
      'apps/suite/src/components/invite/accept-invitation.tsx',
      'apps/suite/src/app/[locale]/invite/accept/page.tsx',
    ]) {
      expect(
        found.some((v) => v.startsWith(`no-admin-or-jobs-reachable-from-suite: ${from}`)),
        from,
      ).toBe(true);
    }
  });

  it('rejects the web app importing the admin client directly, and platform-db re-exporting it', async () => {
    const root = fixtureRepo({
      ...base,
      'apps/suite/src/auth/invitations.ts':
        "import { createServiceRoleSupabaseClient } from '../../../../packages/platform-db/src/admin/index';\nexport const a = createServiceRoleSupabaseClient;\n",
      // A platform-db request-path module re-exporting the admin client.
      'packages/platform-db/src/bridge.ts': "export { withAdminTx } from './admin/index';\n",
    });
    const found = await adminViolations(root);
    expect(found).toContain(
      'no-admin-or-jobs-db-in-suite-app: apps/suite/src/auth/invitations.ts → packages/platform-db/src/admin/index.ts',
    );
    expect(found).toContain(
      'admin-client-only-in-jobs-or-admin: apps/suite/src/auth/invitations.ts → packages/platform-db/src/admin/index.ts',
    );
    expect(found).toContain(
      'platform-db-admin-only-from-admin-or-jobs: packages/platform-db/src/bridge.ts → packages/platform-db/src/admin/index.ts',
    );
  });
});

describe('rules on installed packages fire (C1: node_modules is not excluded)', () => {
  const installed = {
    'package.json': JSON.stringify({
      name: 'fixture',
      private: true,
      dependencies: {
        postgres: '1.0.0',
        '@supabase/supabase-js': '1.0.0',
        react: '1.0.0',
        pg: '1.0.0',
        'graphile-worker': '1.0.0',
      },
    }),
    'node_modules/pg/package.json': JSON.stringify({ name: 'pg', main: 'index.js' }),
    'node_modules/pg/index.js': 'module.exports = {};\n',
    'node_modules/graphile-worker/package.json': JSON.stringify({
      name: 'graphile-worker',
      main: 'index.js',
    }),
    'node_modules/graphile-worker/index.js': 'module.exports = {};\n',
    'node_modules/postgres/package.json': JSON.stringify({ name: 'postgres', main: 'index.js' }),
    'node_modules/postgres/index.js': 'module.exports = {};\n',
    'node_modules/@supabase/supabase-js/package.json': JSON.stringify({
      name: '@supabase/supabase-js',
      main: 'index.js',
    }),
    'node_modules/@supabase/supabase-js/index.js': 'module.exports = {};\n',
    'node_modules/react/package.json': JSON.stringify({ name: 'react', main: 'index.js' }),
    'node_modules/react/index.js': 'module.exports = {};\n',
    'node_modules/vitest/package.json': JSON.stringify({ name: 'vitest', main: 'index.js' }),
    'node_modules/vitest/index.js': 'module.exports = {};\n',
    'node_modules/next/package.json': JSON.stringify({ name: 'next', main: 'index.js' }),
    'node_modules/next/index.js': 'module.exports = {};\n',
  };

  it('rejects apps/suite importing the postgres driver or supabase-js directly', async () => {
    const root = fixtureRepo({
      ...installed,
      'apps/suite/package.json': JSON.stringify({ name: '@jadarat/suite' }),
      'apps/suite/src/lib/db.ts':
        "import postgres from 'postgres';\nimport { createClient } from '@supabase/supabase-js';\nexport const x = [postgres, createClient];\n",
    });
    const found = await violations(root);
    expect(found).toContain(
      'postgres-driver-only-in-platform-db: apps/suite/src/lib/db.ts → node_modules/postgres/index.js',
    );
    expect(found).toContain(
      'supabase-js-only-in-platform-db: apps/suite/src/lib/db.ts → node_modules/@supabase/supabase-js/index.js',
    );
  });

  it('allows packages/platform-db to open connections', async () => {
    const root = fixtureRepo({
      ...installed,
      'packages/platform-db/package.json': JSON.stringify({ name: '@jadarat/platform-db' }),
      'packages/platform-db/src/client.ts':
        "import postgres from 'postgres';\nexport const x = postgres;\n",
    });
    expect(await violations(root)).toEqual([]);
  });

  it('opens the job queue (pg, graphile-worker) only in packages/platform-jobs/src/jobs/', async () => {
    const root = fixtureRepo({
      ...installed,
      'packages/platform-jobs/package.json': JSON.stringify({ name: '@jadarat/platform-jobs' }),
      'packages/platform-jobs/src/jobs/runner.ts':
        "import pg from 'pg';\nimport { run } from 'graphile-worker';\nexport const x = [pg, run];\n",
      'packages/platform-jobs/src/helpers.ts': "import pg from 'pg';\nexport const y = pg;\n",
      'apps/worker/package.json': JSON.stringify({ name: '@jadarat/worker' }),
      'apps/worker/src/main.ts': "import { run } from 'graphile-worker';\nexport const z = run;\n",
    });
    expect(await violations(root)).toEqual([
      'queue-driver-only-in-platform-jobs: apps/worker/src/main.ts → node_modules/graphile-worker/index.js',
      'queue-driver-only-in-platform-jobs: packages/platform-jobs/src/helpers.ts → node_modules/pg/index.js',
    ]);
  });

  it('rejects React in the framework-free kernel', async () => {
    const root = fixtureRepo({
      ...installed,
      'packages/platform-core/package.json': JSON.stringify({ name: '@jadarat/platform-core' }),
      'packages/platform-core/src/x.ts': "import react from 'react';\nexport const x = react;\n",
    });
    expect(await violations(root)).toContain(
      'kernel-framework-free: packages/platform-core/src/x.ts → node_modules/react/index.js',
    );
  });

  it('rejects production code importing a devDependency, but allows peer+dev (provided by the app)', async () => {
    const root = fixtureRepo({
      ...installed,
      'packages/platform-x/package.json': JSON.stringify({
        name: '@jadarat/platform-x',
        peerDependencies: { next: '*' },
        devDependencies: { vitest: '1.0.0', next: '1.0.0' },
      }),
      'packages/platform-x/src/a.ts': "import { x } from 'vitest';\nexport const a = x;\n",
      'packages/platform-x/src/b.ts': "import next from 'next';\nexport const b = next;\n",
      'packages/platform-x/src/a.test.ts': "import { x } from 'vitest';\nexport const t = x;\n",
    });
    const found = await violations(root);
    expect(found).toContain(
      'not-to-dev-dep: packages/platform-x/src/a.ts → node_modules/vitest/index.js',
    );
    expect(found.filter((v) => v.includes('b.ts') || v.includes('a.test.ts'))).toEqual([]);
  });

  it('lets Storybook stories and .storybook config use devDependencies, but not components', async () => {
    const root = fixtureRepo({
      ...installed,
      'packages/ui-x/package.json': JSON.stringify({
        name: '@jadarat/ui-x',
        devDependencies: { vitest: '1.0.0' },
      }),
      'packages/ui-x/src/button.tsx': "import { x } from 'vitest';\nexport const b = x;\n",
      'packages/ui-x/src/button.stories.tsx': "import { x } from 'vitest';\nexport const s = x;\n",
      'packages/ui-x/.storybook/main.ts': "import { x } from 'vitest';\nexport const m = x;\n",
    });
    const found = await violations(root);
    expect(found).toContain(
      'not-to-dev-dep: packages/ui-x/src/button.tsx → node_modules/vitest/index.js',
    );
    expect(found.filter((v) => v.includes('stories') || v.includes('.storybook'))).toEqual([]);
  });

  it('rejects production code importing a story, Storybook config or a test file', async () => {
    const root = fixtureRepo({
      ...installed,
      'packages/ui-y/package.json': JSON.stringify({ name: '@jadarat/ui-y' }),
      'packages/ui-y/.storybook/l10n.ts': 'export const pick = 1;\n',
      'packages/ui-y/src/card.stories.tsx': 'export const story = 1;\n',
      'packages/ui-y/src/card.tsx':
        "import { pick } from '../.storybook/l10n';\nimport { story } from './card.stories';\nexport const c = pick + story;\n",
      'packages/ui-y/src/other.stories.tsx':
        "import { c } from './card';\nimport { story } from './card.stories';\nexport const s = c + story;\n",
    });
    const found = await violations(root);
    expect(found).toContain(
      'no-prod-to-test-files: packages/ui-y/src/card.tsx → packages/ui-y/.storybook/l10n.ts',
    );
    expect(found).toContain(
      'no-prod-to-test-files: packages/ui-y/src/card.tsx → packages/ui-y/src/card.stories.tsx',
    );
    expect(found.filter((v) => v.includes('other.stories'))).toEqual([]);
  });
});
