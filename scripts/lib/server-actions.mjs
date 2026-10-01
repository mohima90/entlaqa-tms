/**
 * ADR 0003 §4.6 — every exported server action and mutating route handler in modules/** and
 * packages/platform-*\/** (and apps/**) must be created with defineAction / defineRoute.
 *
 * Rules (AST-based, TypeScript compiler API; .ts/.tsx/.js/.jsx/.mjs/.cjs):
 *  - A file with a top-level 'use server' directive may only export `const X = defineAction({...})`.
 *    No exported functions, default exports, re-exports (`export { … } from`, `export *`) or
 *    `export let/var`.
 *  - Inline 'use server' directives inside functions are forbidden (they bypass defineAction).
 *  - route.(ts|tsx|js|mjs|cjs) may only export POST/PUT/PATCH/DELETE as `const X = defineRoute({...})`
 *    and may not use `export *` (it could re-export a mutating handler unchecked).
 *  - In action and route files, `defineAction` / `defineRoute` must be IMPORTED from the platform
 *    package (@jadarat/platform-rbac) — a local or foreign function with the same name is rejected.
 *  - `definePublicAction` (pre-tenant sign-in flows, no permission check) is allowed ONLY in
 *    apps/suite/src/auth/*.ts(x), so every unauthenticated entry point lives in one reviewed place.
 */
import ts from 'typescript';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Packages allowed to provide defineAction / defineRoute. */
export const PLATFORM_ACTION_PACKAGES = new Set(['@jadarat/platform-rbac']);
const FACTORIES = ['defineAction', 'defineRoute', 'definePublicAction'];
/** The only files that may export definePublicAction() actions (ADR 0003 §2 sign-in flows). */
export const PUBLIC_ACTION_FILES = /^apps\/suite\/src\/auth\/[^/]+\.(ts|tsx)$/;

/** File extensions scanned by the gate. */
export const SCANNED_SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function scriptKind(fileName) {
  if (/\.tsx$/.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Local names bound by `import { defineAction } from '<platform package>'` (no renaming). */
function platformFactoryImports(sf) {
  const names = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const bindings = st.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || st.importClause.isTypeOnly) continue;
    for (const el of bindings.elements) {
      const imported = (el.propertyName ?? el.name).text;
      if (
        !el.isTypeOnly &&
        FACTORIES.includes(imported) &&
        imported === el.name.text &&
        PLATFORM_ACTION_PACKAGES.has(st.moduleSpecifier.text)
      ) {
        names.add(el.name.text);
      }
    }
  }
  return names;
}

/** Every binding named defineAction/defineRoute that is NOT the platform import. */
function foreignFactoryBindings(sf) {
  const found = [];
  const visit = (node) => {
    let name;
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isImportEqualsDeclaration(node) ||
        ts.isNamespaceImport(node) ||
        ts.isImportClause(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      name = node.name;
    } else if (ts.isImportSpecifier(node)) {
      const decl = node.parent.parent.parent;
      const fromPlatform =
        ts.isStringLiteral(decl.moduleSpecifier) &&
        PLATFORM_ACTION_PACKAGES.has(decl.moduleSpecifier.text) &&
        (node.propertyName ?? node.name).text === node.name.text;
      if (!fromPlatform) name = node.name;
    } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      name = node.name;
    }
    if (name && FACTORIES.includes(name.text)) found.push(name);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function hasUseServerDirective(statements) {
  for (const st of statements) {
    if (!ts.isExpressionStatement(st) || !ts.isStringLiteral(st.expression)) return false;
    if (st.expression.text === 'use server') return true;
  }
  return false;
}

function isExported(node) {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** `module.exports = …`, `module.exports.x = …` or `exports.x = …` (CommonJS exports). */
function isCommonJsExport(st) {
  if (!ts.isExpressionStatement(st) || !ts.isBinaryExpression(st.expression)) return false;
  if (st.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  let target = st.expression.left;
  while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    const object = target.expression;
    if (ts.isIdentifier(object) && object.text === 'exports') return true;
    if (
      ts.isPropertyAccessExpression(object) &&
      ts.isIdentifier(object.expression) &&
      object.expression.text === 'module' &&
      object.name.text === 'exports'
    ) {
      return true;
    }
    if (
      ts.isIdentifier(object) &&
      object.text === 'module' &&
      ts.isPropertyAccessExpression(target)
    ) {
      return target.name.text === 'exports';
    }
    target = object;
  }
  return false;
}

function isCallTo(expr, name) {
  return (
    expr !== undefined &&
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === name
  );
}

/**
 * @param {string} fileName
 * @param {string} source
 * @returns {string[]} violations
 */
export function checkServerActionsSource(fileName, source) {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const errors = [];
  const where = (node) =>
    `${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const isActionFile = hasUseServerDirective(sf.statements);
  const isRouteFile = /(^|\/)route\.(ts|tsx|js|jsx|mjs|cjs)$/.test(fileName);

  if (isActionFile || isRouteFile) {
    const platformNames = platformFactoryImports(sf);
    for (const name of foreignFactoryBindings(sf)) {
      errors.push(
        `${where(name)}: "${name.text}" must be imported from ${[...PLATFORM_ACTION_PACKAGES].join(' or ')}, not defined or imported from elsewhere`,
      );
    }
    const usesFactory = (factory) => {
      let used = false;
      const visit = (node) => {
        if (isCallTo(node, factory)) used = true;
        else ts.forEachChild(node, visit);
      };
      visit(sf);
      return used;
    };
    for (const factory of FACTORIES) {
      if (usesFactory(factory) && !platformNames.has(factory)) {
        errors.push(
          `${fileName}: ${factory}() is used but not imported from ${[...PLATFORM_ACTION_PACKAGES].join(' or ')}`,
        );
      }
    }
  }

  for (const st of sf.statements) {
    if (isActionFile) {
      if (isCommonJsExport(st)) {
        errors.push(
          `${where(st)}: 'use server' files may not use CommonJS exports; export const X = defineAction(...)`,
        );
      } else if (ts.isExportAssignment(st) || ts.isExportDeclaration(st)) {
        errors.push(
          `${where(st)}: 'use server' files may not use default exports or re-exports; export const X = defineAction(...)`,
        );
      } else if (ts.isFunctionDeclaration(st) && isExported(st)) {
        errors.push(
          `${where(st)}: exported server action "${st.name?.text ?? 'default'}" must be created with defineAction()`,
        );
      } else if (ts.isClassDeclaration(st) && isExported(st)) {
        errors.push(`${where(st)}: 'use server' files may only export defineAction() actions`);
      } else if (ts.isVariableStatement(st) && isExported(st)) {
        if (!(st.declarationList.flags & ts.NodeFlags.Const)) {
          errors.push(`${where(st)}: exported server actions must be const`);
        }
        for (const decl of st.declarationList.declarations) {
          const publicAction = isCallTo(decl.initializer, 'definePublicAction');
          if (publicAction && !PUBLIC_ACTION_FILES.test(fileName)) {
            errors.push(
              `${where(decl)}: definePublicAction() is allowed only in apps/suite/src/auth/ (unauthenticated entry points)`,
            );
          } else if (!publicAction && !isCallTo(decl.initializer, 'defineAction')) {
            errors.push(
              `${where(decl)}: exported server action "${decl.name.getText(sf)}" must be created with defineAction()`,
            );
          }
        }
      }
    }
    if (isRouteFile) {
      if (ts.isFunctionDeclaration(st) && isExported(st) && st.name && MUTATING.has(st.name.text)) {
        errors.push(
          `${where(st)}: mutating route handler ${st.name.text} must be created with defineRoute()`,
        );
      }
      if (ts.isVariableStatement(st) && isExported(st)) {
        for (const decl of st.declarationList.declarations) {
          if (
            ts.isIdentifier(decl.name) &&
            MUTATING.has(decl.name.text) &&
            !isCallTo(decl.initializer, 'defineRoute')
          ) {
            errors.push(
              `${where(decl)}: mutating route handler ${decl.name.text} must be created with defineRoute()`,
            );
          }
        }
      }
      if (
        ts.isExportDeclaration(st) &&
        (!st.exportClause || ts.isNamespaceExport(st.exportClause))
      ) {
        errors.push(
          `${where(st)}: route files may not use \`export *\`; declare each handler in this file (mutating ones with defineRoute())`,
        );
      }
      if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          if (MUTATING.has(el.name.text)) {
            errors.push(
              `${where(el)}: mutating route handler ${el.name.text} must be declared with defineRoute() in this file`,
            );
          }
        }
      }
    }
  }

  // Inline 'use server' inside function bodies (closures) bypass defineAction.
  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      node.body &&
      ts.isBlock(node.body) &&
      hasUseServerDirective(node.body.statements)
    ) {
      errors.push(
        `${where(node)}: inline 'use server' functions are not allowed; use defineAction() in a 'use server' module`,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return errors;
}
