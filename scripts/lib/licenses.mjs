/**
 * Licence policy (Development Plan §5.3 gate 1, §8.3 supply chain).
 * Permissive licences are allowed. Weak copyleft (MPL-2.0 file-level) is allowed for unmodified
 * dependencies. Strong copyleft / network copyleft / unknown licences fail, except explicit,
 * reviewed exceptions below.
 */
export const ALLOWED = new Set([
  'MIT',
  'MIT-0', // MIT without the attribution condition (nodemailer, T-M2-06b)
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'Unlicense',
  'Python-2.0',
  'MPL-2.0',
  'Zlib',
  'WTFPL',
]);

/** Reviewed exceptions: package name → reason. */
export const EXCEPTIONS = new Map([
  [
    '@img/sharp-libvips-linux-x64',
    'LGPL-3.0 libvips, dynamically linked prebuilt binary used by sharp (Next.js image optimisation); not modified',
  ],
  ['@img/sharp-libvips-linuxmusl-x64', 'as above (musl build)'],
  ['@img/sharp-libvips-linux-arm64', 'as above (arm64 build)'],
  ['@img/sharp-libvips-darwin-arm64', 'as above (macOS build)'],
]);

/** Splits an SPDX expression into identifiers, operators and parentheses. */
function tokenize(expression) {
  return expression
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (/^(and|or|with)$/i.test(token) ? token.toUpperCase() : token));
}

/**
 * Parses an SPDX licence expression (SPDX spec Annex D: `WITH` binds tighter than `AND`, which binds
 * tighter than `OR`; parentheses group) and evaluates it against the policy:
 *   A AND B  → allowed only if BOTH are allowed (the package is under both licences);
 *   A OR B   → allowed if EITHER is allowed (we may choose);
 *   A WITH E → allowed if A is allowed (an exception only grants additional permissions);
 *   A+       → treated as A.
 * Malformed expressions are not allowed.
 * @returns {boolean}
 */
export function isAllowedExpression(expression) {
  const tokens = tokenize(expression ?? '');
  let pos = 0;
  const peek = () => tokens[pos];
  const fail = () => {
    throw new SyntaxError(`invalid SPDX expression "${expression}"`);
  };

  const parseOr = () => {
    let value = parseAnd();
    while (peek() === 'OR') {
      pos += 1;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  };
  const parseAnd = () => {
    let value = parseWith();
    while (peek() === 'AND') {
      pos += 1;
      const right = parseWith();
      value = value && right;
    }
    return value;
  };
  const parseWith = () => {
    const value = parseAtom();
    if (peek() === 'WITH') {
      pos += 2;
      if (pos > tokens.length || ['AND', 'OR', 'WITH', '(', ')'].includes(tokens[pos - 1])) fail();
    }
    return value;
  };
  const parseAtom = () => {
    const token = peek();
    if (token === undefined || ['AND', 'OR', 'WITH', ')'].includes(token)) fail();
    pos += 1;
    if (token === '(') {
      const value = parseOr();
      if (peek() !== ')') fail();
      pos += 1;
      return value;
    }
    return ALLOWED.has(token.replace(/\+$/, ''));
  };

  try {
    const value = parseOr();
    if (pos !== tokens.length) fail();
    return value;
  } catch {
    return false;
  }
}

/**
 * @param {Record<string, {name: string, versions?: string[]}[]>} byLicense output of `pnpm licenses list --json`
 * @returns {string[]} violations
 */
export function checkLicenses(byLicense) {
  const errors = [];
  for (const [license, packages] of Object.entries(byLicense)) {
    if (isAllowedExpression(license)) continue;
    for (const pkg of packages) {
      if (EXCEPTIONS.has(pkg.name)) continue;
      errors.push(
        `${pkg.name}@${(pkg.versions ?? []).join(',')}: licence "${license}" is not allowed`,
      );
    }
  }
  return errors;
}
