/**
 * Permission registry (ADR 0003 §3). Permissions are namespaced `<module>.<resource>.<action>` and
 * declared in code by each module; the registry is the single source of truth.
 */
export type RiskLevel = 'low' | 'medium' | 'high';

export type PermissionCode = `${string}.${string}.${string}`;

export interface LocalizedText {
  readonly ar: string;
  readonly en: string;
}

export interface PermissionDefinition<C extends PermissionCode = PermissionCode> {
  readonly code: C;
  readonly label: LocalizedText;
  readonly description: LocalizedText;
  readonly risk: RiskLevel;
  /** Privileged permissions require MFA (AAL2) on the session. */
  readonly requiresAal2: boolean;
}

const CODE_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export class PermissionDefinitionError extends Error {
  override readonly name = 'PermissionDefinitionError';
}

/**
 * Declares a module's permissions. Validates format, namespace, uniqueness and that high-risk
 * permissions require AAL2. Returns a record keyed by code for type-safe references.
 */
export function definePermissions<const D extends readonly PermissionDefinition[]>(
  moduleNamespace: string,
  definitions: D,
): { readonly [K in D[number] as K['code']]: K } {
  const seen = new Set<string>();
  const byCode: Record<string, PermissionDefinition> = {};
  for (const def of definitions) {
    if (!CODE_RE.test(def.code)) {
      throw new PermissionDefinitionError(`Invalid permission code "${def.code}"`);
    }
    if (!def.code.startsWith(`${moduleNamespace}.`)) {
      throw new PermissionDefinitionError(
        `Permission "${def.code}" is outside namespace "${moduleNamespace}"`,
      );
    }
    if (seen.has(def.code))
      throw new PermissionDefinitionError(`Duplicate permission "${def.code}"`);
    if (def.risk === 'high' && !def.requiresAal2) {
      throw new PermissionDefinitionError(`High-risk permission "${def.code}" must require AAL2`);
    }
    if (!def.label.ar.trim() || !def.label.en.trim()) {
      throw new PermissionDefinitionError(
        `Permission "${def.code}" needs Arabic and English labels`,
      );
    }
    seen.add(def.code);
    byCode[def.code] = def;
  }
  return Object.freeze(byCode) as { readonly [K in D[number] as K['code']]: K };
}

export interface PermissionRegistry {
  get(code: string): PermissionDefinition | undefined;
  has(code: string): boolean;
  all(): readonly PermissionDefinition[];
}

/** Combines module permission sets; fails on duplicates across modules. */
export function createPermissionRegistry(
  ...sets: readonly Readonly<Record<string, PermissionDefinition>>[]
): PermissionRegistry {
  const map = new Map<string, PermissionDefinition>();
  for (const set of sets) {
    for (const def of Object.values(set)) {
      if (map.has(def.code)) {
        throw new PermissionDefinitionError(`Duplicate permission "${def.code}" across modules`);
      }
      map.set(def.code, def);
    }
  }
  return {
    get: (code) => map.get(code),
    has: (code) => map.has(code),
    all: () => [...map.values()],
  };
}
