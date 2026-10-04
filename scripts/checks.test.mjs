import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { isAllowedExpression, checkLicenses } from './lib/licenses.mjs';
import { checkLogicalSource } from './lib/logical-css.mjs';
import { checkMigrationNames, checkRollbacks, schemasFromModules } from './lib/migration-names.mjs';
import { checkServerActionsSource } from './lib/server-actions.mjs';
import { checkSupabaseApiConfig } from './lib/supabase-config.mjs';
import { restrictedSyntax } from '../packages/config/eslint/index.js';

const fixture = (name) =>
  readFileSync(new URL(`./__fixtures__/actions/${name}`, import.meta.url), 'utf8');

describe('migration naming (ADR 0001)', () => {
  const schemas = schemasFromModules(['tms', 'core-hr']);

  it('accepts the convention for platform, private and module schemas', () => {
    expect(schemas).toEqual(['platform', 'private', 'tms', 'core_hr']);
    expect(
      checkMigrationNames(
        [
          '.gitkeep',
          '20260930120000_platform__roles.sql',
          '20261001000000_tms__sessions.sql',
          '20261002000000_core_hr__employees.sql',
        ],
        schemas,
      ),
    ).toEqual([]);
  });

  it('rejects bad names, unknown schemas, invalid and duplicate timestamps', () => {
    const errors = checkMigrationNames(
      [
        '2026_init.sql',
        '20260930120000_payroll__x.sql',
        '20261399000000_tms__x.sql',
        '20261001000000_tms__a.sql',
        '20261001000000_tms__b.sql',
        '20260101000000_TMS__x.sql',
      ],
      schemas,
    );
    expect(errors.join('\n')).toMatch(/2026_init\.sql: must match/);
    expect(errors.join('\n')).toMatch(/unknown schema "payroll"/);
    expect(errors.join('\n')).toMatch(/invalid timestamp 20261399000000/);
    expect(errors.join('\n')).toMatch(/duplicate timestamp 20261001000000/);
    expect(errors.join('\n')).toMatch(/20260101000000_TMS__x\.sql: must match/);
  });
});

describe('rollback scripts (migration-conventions.md §6)', () => {
  it('requires one rollback per migration and no orphans', () => {
    expect(checkRollbacks(['a.sql', 'b.sql'], ['a.sql', 'b.sql', '.gitkeep'])).toEqual([]);
    expect(checkRollbacks(['a.sql', 'b.sql'], ['a.sql', 'c.sql'])).toEqual([
      'b.sql: missing supabase/rollbacks/b.sql',
      'rollbacks/c.sql: no matching migration',
    ]);
  });
});

describe('Supabase Data API exposure (ADR 0002 §5)', () => {
  it('accepts the committed config.toml (API disabled, nothing exposed)', () => {
    const toml = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
    expect(checkSupabaseApiConfig(toml)).toEqual([]);
  });

  it('rejects an enabled Data API or any exposed schema, including public', () => {
    expect(
      checkSupabaseApiConfig(
        '[api]\nenabled = true\nschemas = ["public", "graphql_public"]\n[db]\nschemas = 1\n',
      ),
    ).toEqual([
      'supabase/config.toml: [api] enabled must be false (ADR 0002 §5: no Data API)',
      'supabase/config.toml: schema "public" must not be exposed through the Data API',
      'supabase/config.toml: schema "graphql_public" must not be exposed through the Data API',
    ]);
    expect(checkSupabaseApiConfig('[api]\nenabled = false # off\nschemas = [ "tms" ]\n')).toEqual([
      'supabase/config.toml: schema "tms" must not be exposed through the Data API',
    ]);
    expect(checkSupabaseApiConfig('[db]\nport = 1\n')).toHaveLength(1);
  });
});

describe('server actions gate (ADR 0003 §4.6)', () => {
  it('allows definePublicAction only in apps/suite/src/auth/ (unauthenticated entry points)', () => {
    const src =
      "'use server';\nimport { definePublicAction } from '@jadarat/platform-rbac';\nexport const signIn = definePublicAction({});\n";
    expect(checkServerActionsSource('apps/suite/src/auth/actions.ts', src)).toEqual([]);
    for (const elsewhere of [
      'apps/suite/src/app/[locale]/sign-in/actions.ts',
      'apps/suite/src/auth/nested/actions.ts',
      'modules/tms/src/actions.ts',
      'packages/platform-identity/src/actions.ts',
    ]) {
      expect(checkServerActionsSource(elsewhere, src).join('\n')).toMatch(
        /definePublicAction\(\) is allowed only in apps\/suite\/src\/auth\//,
      );
    }
    const foreign =
      "'use server';\nimport { definePublicAction } from './mine';\nexport const signIn = definePublicAction({});\n";
    expect(checkServerActionsSource('apps/suite/src/auth/actions.ts', foreign).join('\n')).toMatch(
      /"definePublicAction" must be imported from @jadarat\/platform-rbac/,
    );
  });

  it('allows definePublicRoute only in the reviewed public route files', () => {
    const src =
      "import { definePublicRoute } from '@jadarat/platform-rbac';\nexport const POST = definePublicRoute({});\n";
    expect(
      checkServerActionsSource('apps/suite/src/app/api/monitoring/errors/route.ts', src),
    ).toEqual([]);
    for (const elsewhere of [
      'apps/suite/src/app/api/other/route.ts',
      'apps/suite/src/app/api/monitoring/errors/nested/route.ts',
      'modules/tms/src/app/api/monitoring/errors/route.ts',
    ]) {
      expect(checkServerActionsSource(elsewhere, src).join('\n')).toMatch(
        /definePublicRoute\(\) is allowed only in the reviewed public route files/,
      );
    }
    const foreign =
      "import { definePublicRoute } from './mine';\nexport const POST = definePublicRoute({});\n";
    expect(
      checkServerActionsSource('apps/suite/src/app/api/monitoring/errors/route.ts', foreign).join(
        '\n',
      ),
    ).toMatch(/"definePublicRoute" must be imported from @jadarat\/platform-rbac/);
    // No indirect use: importing or calling it anywhere else fails, route file or not.
    const wrapped =
      "import { definePublicRoute, defineRoute } from '@jadarat/platform-rbac';\nconst h = definePublicRoute({});\nexport const POST = defineRoute(h);\n";
    expect(
      checkServerActionsSource('apps/suite/src/app/api/x/route.ts', wrapped).join('\n'),
    ).toMatch(/definePublicRoute\(\) is allowed only/);
    const helper =
      "import { definePublicRoute as d } from '@jadarat/platform-rbac';\nexport const x = d;\n";
    expect(checkServerActionsSource('apps/suite/src/lib/helper.ts', helper).join('\n')).toMatch(
      /definePublicRoute\(\) is allowed only/,
    );
    for (const indirect of [
      "import * as r from '@jadarat/platform-rbac';\nexport const x = r.definePublicRoute({});\n",
      "import * as r from '@jadarat/platform-rbac';\nexport const x = r['definePublicRoute'];\n",
      "export { definePublicRoute } from '@jadarat/platform-rbac';\n",
      "const { definePublicRoute: d } = await import('@jadarat/platform-rbac');\n",
      "import { createDefinePublicRoute } from '@jadarat/platform-rbac';\nexport const d = createDefinePublicRoute({});\n",
    ]) {
      expect(checkServerActionsSource('apps/suite/src/lib/x.ts', indirect).join('\n')).toMatch(
        /definePublicRoute\(\) is allowed only/,
      );
    }
    expect(
      checkServerActionsSource(
        'packages/platform-rbac/src/index.ts',
        "import { createDefinePublicRoute } from './x';\nexport const definePublicRoute = createDefinePublicRoute({});\n",
      ),
    ).toEqual([]);
  });

  it('accepts defineAction exports', () => {
    expect(checkServerActionsSource('modules/tms/src/actions/good.ts', fixture('good.ts'))).toEqual(
      [],
    );
  });

  it('rejects exported functions, non-defineAction consts, let, default and re-exports', () => {
    const errors = checkServerActionsSource('modules/tms/src/actions/bad.ts', fixture('bad.ts'));
    expect(errors).toHaveLength(6);
    expect(errors.join('\n')).toMatch(/defineAction\(\) is used but not imported/);
    expect(errors.join('\n')).toMatch(/"deleteEverything" must be created with defineAction/);
    expect(errors.join('\n')).toMatch(/"sneaky" must be created with defineAction/);
    expect(errors.join('\n')).toMatch(/must be const/);
    expect(errors.join('\n')).toMatch(/default exports or re-exports/);
  });

  it('rejects inline use server functions', () => {
    expect(
      checkServerActionsSource('modules/tms/src/page.tsx', fixture('inline.tsx')),
    ).toHaveLength(1);
  });

  it('requires defineRoute for mutating route handlers only', () => {
    const errors = checkServerActionsSource('modules/tms/src/api/route.ts', fixture('route.ts'));
    expect(errors).toHaveLength(4);
    expect(errors.join('\n')).not.toMatch(/GET|PUT/);
    // PUT = defineRoute({}) without importing it from the platform package.
    expect(errors.join('\n')).toMatch(/defineRoute\(\) is used but not imported/);
  });

  it('rejects `export *` in action and route files (JavaScript route files too)', () => {
    expect(
      checkServerActionsSource('modules/tms/src/actions/x.ts', fixture('export-star.ts')),
    ).toEqual([
      expect.stringMatching(/:6: 'use server' files may not use default exports or re-exports/),
    ]);
    const route = checkServerActionsSource(
      'apps/suite/src/app/api/x/route.js',
      fixture('route-star.js'),
    );
    expect(route).toHaveLength(2);
    expect(route.every((e) => e.includes('may not use `export *`'))).toBe(true);
  });

  it('scans JavaScript "use server" files (.mjs/.js/.cjs)', () => {
    expect(
      checkServerActionsSource('apps/suite/src/actions/plain.mjs', fixture('plain.mjs')),
    ).toEqual([expect.stringMatching(/"deleteEverything" must be created with defineAction/)]);
    expect(
      checkServerActionsSource('apps/suite/src/actions/good.mjs', fixture('good.mjs')),
    ).toEqual([]);
    for (const cjs of [
      "'use server';\nexports.x = async () => {};\n",
      "'use server';\nmodule.exports = { x: async () => {} };\n",
      "'use server';\nmodule.exports.x = async () => {};\n",
    ]) {
      expect(checkServerActionsSource('apps/suite/src/actions/x.cjs', cjs)).toEqual([
        expect.stringMatching(/may not use CommonJS exports/),
      ]);
    }
    expect(
      checkServerActionsSource(
        'apps/suite/src/actions/x.cjs',
        "'use server';\nexport function x() {}\n",
      ),
    ).toHaveLength(1);
  });

  it('rejects a locally redefined or foreign defineAction (must come from the platform package)', () => {
    const local = checkServerActionsSource(
      'modules/tms/src/actions/l.ts',
      fixture('local-define.ts'),
    );
    expect(local.join('\n')).toMatch(
      /:4: "defineAction" must be imported from @jadarat\/platform-rbac/,
    );
    expect(local.join('\n')).toMatch(/defineAction\(\) is used but not imported/);
    const foreign = checkServerActionsSource(
      'modules/tms/src/actions/f.ts',
      fixture('foreign-import.ts'),
    );
    expect(foreign.join('\n')).toMatch(
      /:3: "defineAction" must be imported from @jadarat\/platform-rbac/,
    );
    const renamed = checkServerActionsSource(
      'modules/tms/src/actions/r.ts',
      fixture('renamed-import.ts'),
    );
    expect(renamed.join('\n')).toMatch(
      /"defineAction" must be imported from @jadarat\/platform-rbac/,
    );
    expect(
      checkServerActionsSource(
        'modules/tms/src/actions/p.ts',
        "'use server';\nimport { defineAction } from '@jadarat/platform-rbac';\nconst make = (defineAction: unknown) => defineAction;\nexport const a = defineAction({});\n",
      ).join('\n'),
    ).toMatch(/:3: "defineAction" must be imported/);
  });

  it('ignores files without a use server directive', () => {
    expect(
      checkServerActionsSource(
        'packages/platform-core/src/x.ts',
        'export async function helper() {}',
      ),
    ).toEqual([]);
  });
});

describe('RTL logical properties', () => {
  it('flags physical Tailwind utilities and CSS properties', () => {
    expect(
      checkLogicalSource(
        'a.tsx',
        '<div className="ml-4 pr-2 text-left left-0 border-r rounded-tl-md" />',
      ),
    ).toHaveLength(6);
    expect(
      checkLogicalSource('a.css', '.x { margin-left: 0; text-align: right; left: 0 }'),
    ).toHaveLength(3);
  });

  it('accepts logical utilities and properties', () => {
    expect(
      checkLogicalSource(
        'a.tsx',
        '<div className="ms-4 pe-2 text-start start-0 border-e -translate-y-24 xl:ps-8" />',
      ),
    ).toEqual([]);
    expect(
      checkLogicalSource(
        'a.css',
        '.x { margin-inline-start: 0; inset-inline-end: 0; } /* margin-left: 0 */',
      ),
    ).toEqual([]);
  });
});

describe('licence policy', () => {
  it('evaluates SPDX expressions', () => {
    expect(isAllowedExpression('MIT')).toBe(true);
    expect(isAllowedExpression('Apache-2.0 AND MIT')).toBe(true);
    expect(isAllowedExpression('(MIT OR GPL-3.0)')).toBe(true);
    expect(isAllowedExpression('GPL-3.0')).toBe(false);
    expect(isAllowedExpression('MIT AND AGPL-3.0')).toBe(false);
    expect(isAllowedExpression('')).toBe(false);
  });

  it('AND requires every operand to be allowed, even when an OR appears elsewhere', () => {
    // The old evaluator accepted these because the expression contained an OR somewhere.
    expect(isAllowedExpression('(MIT OR Apache-2.0) AND GPL-3.0')).toBe(false);
    expect(isAllowedExpression('MIT OR Apache-2.0 AND GPL-3.0')).toBe(true); // AND binds tighter
    expect(isAllowedExpression('(MIT OR Apache-2.0) AND GPL-3.0 OR AGPL-3.0')).toBe(false);
    expect(isAllowedExpression('(MIT OR GPL-3.0) AND (ISC OR AGPL-3.0)')).toBe(true);
    expect(isAllowedExpression('(GPL-2.0 OR GPL-3.0) AND MIT')).toBe(false);
    expect(isAllowedExpression('(MIT AND BSD-3-Clause) OR GPL-3.0')).toBe(true);
    expect(isAllowedExpression('mit or GPL-3.0')).toBe(false); // identifiers are case-sensitive
    expect(isAllowedExpression('MIT or GPL-3.0')).toBe(true); // operators are not
  });

  it('handles WITH exceptions, the + suffix and malformed expressions', () => {
    expect(isAllowedExpression('Apache-2.0 WITH LLVM-exception')).toBe(true);
    expect(isAllowedExpression('GPL-2.0-only WITH Classpath-exception-2.0')).toBe(false);
    expect(isAllowedExpression('MPL-2.0+')).toBe(true);
    for (const bad of ['MIT AND', 'OR MIT', '(MIT', 'MIT)', 'MIT MIT', 'MIT WITH', '()']) {
      expect(isAllowedExpression(bad), bad).toBe(false);
    }
  });

  it('fails disallowed licences unless a reviewed exception exists', () => {
    expect(
      checkLicenses({
        MIT: [{ name: 'a', versions: ['1.0.0'] }],
        'LGPL-3.0-or-later': [{ name: '@img/sharp-libvips-linux-x64', versions: ['1.2.0'] }],
        'AGPL-3.0': [{ name: 'bad', versions: ['2.0.0'] }],
        Unknown: [{ name: 'mystery' }],
      }),
    ).toEqual([
      'bad@2.0.0: licence "AGPL-3.0" is not allowed',
      'mystery@: licence "Unknown" is not allowed',
    ]);
  });
});

describe('ESLint security syntax bans (packages/config/eslint)', async () => {
  // typescript-eslint is a dependency of packages/config, resolved from there.
  const configRequire = createRequire(new URL('../packages/config/package.json', import.meta.url));
  const { default: tseslint } = await import(
    pathToFileURL(configRequire.resolve('typescript-eslint')).href
  );
  const lint = (code) =>
    new Linter({ configType: 'flat' })
      .verify(
        code,
        [
          {
            files: ['**/*.ts'],
            languageOptions: { parser: tseslint.parser },
            rules: { 'no-restricted-syntax': ['error', ...restrictedSyntax] },
          },
        ],
        'x.ts',
      )
      .map((m) => m.message);

  it('bans casts to any claims type, direct or nested', () => {
    for (const code of [
      'const c = raw as VerifiedClaims;',
      'const c = raw as TenantClaims;',
      'const c = raw as JwtClaims;',
      'const c = raw as unknown as TenantClaims;',
      'const c = raw as Readonly<TenantClaims>;',
      'const c = raw as TenantClaims | undefined;',
      'const c = <TenantClaims>raw;',
      'const c = <Partial<VerifiedClaims>>raw;',
    ]) {
      expect(lint(code), code).toEqual([expect.stringMatching(/Do not cast to a claims type/)]);
    }
  });

  it('allows annotations, satisfies and unrelated casts', () => {
    for (const code of [
      'const c: TenantClaims = claims;',
      'function f(c: VerifiedClaims): void {}',
      'const x = raw as Record<string, unknown>;',
      'const y = fn<TenantClaims>(raw) as number;',
      'const z = raw satisfies Partial<JwtClaims>;',
    ]) {
      expect(lint(code), code).toEqual([]);
    }
  });

  it('bans auth.getSession()', () => {
    expect(lint('await supabase.auth.getSession();')).toHaveLength(1);
  });
});
