/**
 * The role builder (FR-IAM-07; EP-ROLES, PO 17 Oct 2026 — Kawadir's roles screen) — client-safe helpers
 * shared by the create / edit pages (server) and the form (client). The same rules are checked again by
 * the action and by the database guards; these only keep the form honest.
 */

export type BuilderScope = 'own' | 'team' | 'departments' | 'organization';
export const BUILDER_SCOPES: readonly BuilderScope[] = [
  'own',
  'team',
  'departments',
  'organization',
];

/** One permission of the accordion, in the page's language. */
export interface BuilderPermission {
  readonly code: string;
  readonly label: string;
  readonly description: string;
  readonly highRisk: boolean;
  /** Administrative: only for a role that sees the whole organization. */
  readonly organizationOnly: boolean;
  /** The Organization Admin holds it organization-wide (only those can be given). */
  readonly held: boolean;
}

export interface BuilderGroup {
  readonly key: string;
  readonly title: string;
  readonly permissions: readonly BuilderPermission[];
}

/** What the form holds. */
export interface BuilderValues {
  readonly nameEn: string;
  readonly nameAr: string;
  readonly description: string;
  readonly dataScope: BuilderScope;
  readonly permissions: readonly string[];
}

/** A «start from» choice (blank, a standard role, a template), prepared on the server. */
export interface BuilderStart {
  /** `blank`, `standard:<code>` or `template:<key>`. */
  readonly value: string;
  readonly label: string;
  readonly group: 'blank' | 'standard' | 'template';
  /** Names and description: filled by templates only (null keeps what was typed). */
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly description: string | null;
  readonly dataScope: BuilderScope;
  readonly permissions: readonly string[];
}

const all = (groups: readonly BuilderGroup[]) => groups.flatMap((g) => g.permissions);

/** Why a permission cannot be ticked now (null: it can). A ticked one can always be cleared. */
export function permissionBlock(
  permission: BuilderPermission,
  scope: BuilderScope,
  checked: boolean,
): 'notHeld' | 'needsOrganization' | null {
  if (checked) return null;
  if (!permission.held) return 'notHeld';
  if (permission.organizationOnly && scope !== 'organization') return 'needsOrganization';
  return null;
}

/** Tick or clear a permission (kept in catalogue order). */
export function togglePermission(
  groups: readonly BuilderGroup[],
  permissions: readonly string[],
  code: string,
  on: boolean,
): string[] {
  const next = new Set(permissions);
  if (on) next.add(code);
  else next.delete(code);
  return all(groups)
    .map((p) => p.code)
    .filter((c) => next.has(c));
}

/**
 * A new data scope: administrative permissions need the whole organization, so they are cleared when the
 * scope narrows (`cleared` says so, for the notice).
 */
export function changeScope(
  groups: readonly BuilderGroup[],
  permissions: readonly string[],
  scope: BuilderScope,
): { readonly permissions: string[]; readonly cleared: boolean } {
  if (scope === 'organization') return { permissions: [...permissions], cleared: false };
  const adminOnly = new Set(
    all(groups)
      .filter((p) => p.organizationOnly)
      .map((p) => p.code),
  );
  const kept = permissions.filter((code) => !adminOnly.has(code));
  return { permissions: kept, cleared: kept.length !== permissions.length };
}

/**
 * Apply a «start from» choice: its scope and permissions (only those the Organization Admin may give; an
 * administrative one only with the whole organization), and a template's names and description.
 */
export function applyStart(
  groups: readonly BuilderGroup[],
  values: BuilderValues,
  start: BuilderStart,
): BuilderValues {
  const byCode = new Map(all(groups).map((p) => [p.code, p]));
  const permissions = start.permissions.filter((code) => {
    const permission = byCode.get(code);
    return (
      permission !== undefined &&
      permission.held &&
      (!permission.organizationOnly || start.dataScope === 'organization')
    );
  });
  return {
    nameEn: start.nameEn ?? values.nameEn,
    nameAr: start.nameAr ?? values.nameAr,
    description: start.description ?? values.description,
    dataScope: start.dataScope,
    permissions: togglePermission(groups, permissions, '', false),
  };
}

/** A role with a high-risk permission is privileged: only the Organization Admin gives it. */
export function builderIsPrivileged(
  groups: readonly BuilderGroup[],
  permissions: readonly string[],
): boolean {
  const chosen = new Set(permissions);
  return all(groups).some((p) => p.highRisk && chosen.has(p.code));
}

/** Text key (namespace `roleBuilder.fieldErrors`) of a field error from the server (codes only). */
export function builderFieldError(
  path: string,
  code: string,
): { readonly field: keyof BuilderValues; readonly key: string } | null {
  switch (path) {
    case 'nameEn':
    case 'nameAr':
      return {
        field: path,
        key: code === 'NAME_TAKEN' ? 'nameTaken' : code === 'TOO_SMALL' ? 'required' : 'name',
      };
    case 'description':
      return { field: 'description', key: 'description' };
    case 'dataScope':
      return { field: 'dataScope', key: 'dataScope' };
    default:
      return path === 'permissions' || path.startsWith('permissions.')
        ? { field: 'permissions', key: 'permissions' }
        : null;
  }
}
