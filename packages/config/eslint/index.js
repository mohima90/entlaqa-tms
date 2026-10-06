import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const IGNORES = [
  '**/node_modules/**',
  '**/.next/**',
  '**/dist/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/storybook-static/**',
  '**/next-env.d.ts',
  'docs/**',
  'scripts/__fixtures__/**',
  'packages/config/**/*.d.ts',
];

/** Any claims type: VerifiedClaims, TenantClaims, JwtClaims and future `…Claims` types. */
const CLAIMS_TYPE = 'TSTypeReference[typeName.name=/Claims$/]';
const CLAIMS_CAST_MESSAGE =
  'Do not cast to a claims type (VerifiedClaims, TenantClaims, …). Obtain claims from @jadarat/platform-identity (or systemClaims() for jobs); narrow with hasTenant().';

/** Security- and architecture-relevant syntax restrictions shared by all TypeScript code. */
export const restrictedSyntax = [
  {
    // ADR 0003 §2 / CLAUDE.md: never trust getSession() on the server; use getClaims()/getUser().
    selector: "MemberExpression[property.name='getSession'][object.property.name='auth']",
    message:
      'Do not use auth.getSession() — verify identity with getClaims()/getUser() (ADR 0003 §2).',
  },
  // ADR 0002 §5: claims passed to the database must come from a server-verified JWT. Casts to ANY claims
  // type are banned, also when nested in the asserted type (e.g. `as Readonly<TenantClaims>`).
  { selector: `TSAsExpression > ${CLAIMS_TYPE}`, message: CLAIMS_CAST_MESSAGE },
  { selector: `TSAsExpression > .typeAnnotation ${CLAIMS_TYPE}`, message: CLAIMS_CAST_MESSAGE },
  { selector: `TSTypeAssertion > ${CLAIMS_TYPE}`, message: CLAIMS_CAST_MESSAGE },
  { selector: `TSTypeAssertion > .typeAnnotation ${CLAIMS_TYPE}`, message: CLAIMS_CAST_MESSAGE },
];

/**
 * Shared flat config (ESLint 9).
 * @param {{ tsconfigRootDir: string }} options
 */
export function createConfig({ tsconfigRootDir }) {
  return tseslint.config(
    { ignores: IGNORES },
    js.configs.recommended,
    {
      files: ['**/*.{js,mjs,cjs}'],
      languageOptions: { globals: { ...globals.node } },
    },
    {
      files: ['**/*.{ts,tsx}'],
      extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
        globals: { ...globals.node },
      },
      rules: {
        'no-console': ['error', { allow: ['warn', 'error'] }],
        'no-restricted-syntax': ['error', ...restrictedSyntax],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        '@typescript-eslint/only-throw-error': 'error',
        '@typescript-eslint/no-floating-promises': 'error',
      },
    },
    {
      files: ['**/*.tsx'],
      plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
      languageOptions: { globals: { ...globals.browser } },
      rules: {
        ...reactHooks.configs.recommended.rules,
        ...jsxA11y.flatConfigs.strict.rules,
      },
    },
    {
      files: ['apps/suite/**/*.{ts,tsx}'],
      plugins: { '@next/next': nextPlugin },
      settings: { next: { rootDir: 'apps/suite/' } },
      rules: {
        ...nextPlugin.configs.recommended.rules,
        ...nextPlugin.configs['core-web-vitals'].rules,
      },
    },
    {
      // Test files may use non-null assertions and looser typing for fixtures.
      files: ['**/*.test.{ts,tsx}', '**/e2e/**/*.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
      },
    },
    prettier,
  );
}

export default createConfig({ tsconfigRootDir: process.cwd() });
