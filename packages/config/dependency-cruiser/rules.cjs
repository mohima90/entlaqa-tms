/**
 * dependency-cruiser rules enforcing ADR 0001 (module boundaries) and ADR 0002 (admin client).
 * Run: `pnpm check:deps` (CI gate). Any `error` violation fails the build.
 * @type {import('dependency-cruiser').IConfiguration}
 */
// Tests, tool configuration and Storybook (stories + .storybook/): never part of a production bundle.
const TEST_FILES =
  '(\\.test\\.tsx?$|/e2e/|\\.config\\.(ts|mjs|js|cjs)$|/playwright\\.config\\.ts$|/\\.storybook/|\\.stories\\.tsx?$)';

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'ADR 0001: no circular dependencies anywhere.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'module-to-other-module',
      severity: 'error',
      comment:
        'ADR 0001: a module talks to another module only through packages/contracts and domain events.',
      from: { path: '^modules/([^/]+)/' },
      to: { path: '^modules/', pathNot: '^modules/$1/' },
    },
    {
      name: 'nothing-to-app',
      severity: 'error',
      comment:
        'ADR 0001: only apps/suite may depend on itself; packages and modules never import the app.',
      from: { path: '^(packages|modules)/' },
      to: { path: '^apps/' },
    },
    {
      name: 'packages-to-modules',
      severity: 'error',
      comment:
        'ADR 0001: platform, ui, contracts and config packages never depend on business modules.',
      from: { path: '^packages/' },
      to: { path: '^modules/' },
    },
    {
      name: 'platform-to-ui',
      severity: 'error',
      comment:
        'ADR 0001: platform packages are UI-free (platform-i18n may reference message types only).',
      from: { path: '^packages/platform-(?!i18n/)[^/]+/' },
      to: { path: '^packages/ui/' },
    },
    {
      name: 'ui-to-platform-or-contracts',
      severity: 'error',
      comment: 'ADR 0001: packages/ui depends only on packages/config (and itself).',
      from: { path: '^packages/ui/' },
      to: { path: '^packages/(platform-[^/]+|contracts)/' },
    },
    {
      name: 'contracts-to-platform',
      severity: 'error',
      comment:
        'ADR 0001: packages/contracts may use types only from platform-core, nothing else from platform.',
      from: { path: '^packages/contracts/' },
      to: { path: '^packages/(platform-(?!core/)[^/]+|ui)/' },
    },
    {
      name: 'contracts-to-platform-core-runtime',
      severity: 'error',
      comment:
        'ADR 0001: packages/contracts may import platform-core for types only (`import type`).',
      from: { path: '^packages/contracts/' },
      to: { path: '^packages/platform-core/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'admin-client-only-in-jobs-or-admin',
      severity: 'error',
      comment:
        'ADR 0001/0002 §7: @jadarat/platform-db/admin (service-level, bypasses tenant context) is importable only from real job/admin roots: packages|modules/<name>/src/{jobs,admin}/ and the future worker app (apps/worker/). A folder merely NAMED admin/ or jobs/ elsewhere (e.g. a Next.js route apps/suite/src/app/[locale]/admin/page.tsx) is a request path and is rejected.',
      from: {
        pathNot: [
          '^packages/platform-db/src/',
          '^(packages|modules)/[^/]+/src/(jobs|admin)/',
          '^apps/worker/',
        ],
      },
      to: { path: '^packages/platform-db/src/admin/' },
    },
    {
      name: 'jobs-db-only-in-jobs',
      severity: 'error',
      comment:
        'ADR 0002 §7 / ADR 0005: withSystemTx (login role app_worker, system-actor claims) is importable only from packages|modules/<name>/src/jobs/ and the future worker app (apps/worker/).',
      from: {
        pathNot: [
          '^packages/platform-db/src/',
          '^(packages|modules)/[^/]+/src/jobs/',
          '^apps/worker/',
        ],
      },
      to: { path: '^packages/platform-db/src/jobs/' },
    },
    {
      name: 'no-admin-or-jobs-db-in-suite-app',
      severity: 'error',
      comment:
        'ADR 0002 §7: nothing in the web app (apps/suite, including every route under src/app/) may reach the admin client or withSystemTx, whatever its folder is called.',
      from: { path: '^apps/suite/' },
      to: { path: '^packages/platform-db/src/(admin|jobs)/' },
    },
    {
      name: 'admin-jobs-folders-are-private',
      severity: 'error',
      comment:
        'ADR 0001/0002 §7 (security re-review): code in a <package|module>/src/{admin,jobs}/ folder may only be imported by other admin/jobs code or the worker app. Prevents laundering the admin client or withSystemTx to request-path code through a re-export (e.g. a module index exporting src/admin/bridge.ts).',
      from: {
        pathNot: [
          '^(packages|modules)/[^/]+/src/(jobs|admin)/',
          '^packages/platform-db/src/',
          '^apps/worker/',
          '\\.(integration\\.)?test\\.tsx?$',
        ],
      },
      to: { path: '^(packages|modules)/[^/]+/src/(admin|jobs)/' },
    },
    {
      name: 'no-admin-or-jobs-reachable-from-suite',
      severity: 'error',
      comment:
        'ADR 0002 §7: the web app must not reach any admin/jobs code transitively (direct-import rules alone miss re-exports).',
      from: { path: '^apps/suite/' },
      to: { path: '^(packages|modules)/[^/]+/src/(admin|jobs)/', reachable: true },
    },
    {
      name: 'verified-claims-brand-restricted',
      severity: 'error',
      comment:
        'ADR 0002 §5 / ADR 0003 §2: only platform-identity (after verifying the JWT) may brand claims as verified. Tests may use it for fixtures.',
      from: {
        pathNot: ['^packages/platform-(core|identity)/', '\\.(integration\\.)?test\\.tsx?$'],
      },
      to: { path: '^packages/platform-core/src/internal/' },
    },
    {
      name: 'supabase-js-only-in-platform-db',
      severity: 'error',
      comment:
        'ADR 0001: Supabase clients (server, browser, admin) are created only in packages/platform-db.',
      from: { pathNot: '^packages/platform-db/' },
      to: { path: '(^|/)node_modules/@supabase/(supabase-js|ssr)/' },
    },
    {
      name: 'postgres-driver-only-in-platform-db',
      severity: 'error',
      comment: 'ADR 0002 §5: database connections are opened only by packages/platform-db.',
      from: { pathNot: '^packages/platform-db/' },
      to: { path: '(^|/)node_modules/postgres/' },
    },
    {
      name: 'queue-driver-only-in-platform-jobs',
      severity: 'error',
      comment:
        'ADR 0005 §2: the job queue (graphile-worker and its pg driver, login role app_queue) is opened only by packages/platform-jobs/src/jobs/; the worker app uses that package.',
      from: { pathNot: '^packages/platform-jobs/src/jobs/' },
      to: { path: '(^|/)node_modules/(pg|graphile-worker)/' },
    },
    {
      name: 'no-relative-cross-package-imports',
      severity: 'error',
      comment:
        'ADR 0001: import other workspace packages by package name via their `exports`, never by relative path into their internals.',
      from: { path: '^(apps|packages|modules)/([^/]+)/' },
      to: {
        path: '^(apps|packages|modules)/',
        pathNot: '^$1/$2/',
        dependencyTypes: ['local'],
      },
    },
    {
      name: 'kernel-framework-free',
      severity: 'error',
      comment:
        'platform-core and contracts are framework-free (usable by jobs, workers and other runtimes).',
      from: { path: '^packages/(platform-core|contracts)/' },
      to: { path: '(^|/)node_modules/(next|react|react-dom)/' },
    },
    {
      name: 'no-prod-to-test-files',
      severity: 'error',
      comment:
        'Production code must not import tests, test tooling or Storybook files: they are exempt from not-to-dev-dep, so importing them would pull devDependencies into a production bundle.',
      from: { path: '^(apps|packages|modules)/', pathNot: TEST_FILES },
      to: { path: TEST_FILES },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        'Production code must not depend on devDependencies. A package that is ALSO a peerDependency (provided by the consuming app, e.g. `next` for platform-identity/next) is allowed; it is a devDependency only so the package can be tested on its own.',
      from: { path: '^(apps|packages|modules)/', pathNot: TEST_FILES },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only', 'npm-peer'] },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Every import must resolve.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // node_modules must NOT be excluded: rules on installed packages (postgres, @supabase/*, next, react,
    // devDependencies) match the resolved node_modules path of the dependency. doNotFollow stops the
    // cruise from descending into them.
    exclude: {
      path: '(^|/)(\\.next|\\.turbo|dist|coverage|playwright-report|test-results|storybook-static)/|next-env\\.d\\.ts$',
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.d.ts'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
