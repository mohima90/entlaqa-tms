import type { Grant } from '../authorize';
import type { CustomRoleDefinition } from '../custom-roles';
import { grantsForAssignments } from '../role-grants';
import type { SystemRoleCode } from '../system-roles';

/**
 * Test fixtures (EP-ROLES): the former system roles the tests still need — Line Manager, Auditor, Finance
 * Manager, Compliance Officer — as the custom roles an Organization Admin builds from the templates, with
 * exactly the platform grants those roles had. Tests name them by their former codes for readability.
 */
const FORMER = {
  line_manager: {
    code: 'custom_000000000001',
    dataScope: 'team',
    permissions: ['platform.user.read', 'platform.role.read', 'platform.org.read'],
  },
  auditor: {
    code: 'custom_000000000002',
    dataScope: 'organization',
    permissions: [
      'platform.user.read',
      'platform.role.read',
      'platform.org.read',
      'platform.tenant.read',
      'platform.audit.read',
    ],
  },
  finance_manager: {
    code: 'custom_000000000003',
    dataScope: 'organization',
    permissions: ['platform.user.read', 'platform.role.read', 'platform.org.read'],
  },
  compliance_officer: {
    code: 'custom_000000000004',
    dataScope: 'organization',
    permissions: [
      'platform.user.read',
      'platform.role.read',
      'platform.org.read',
      'platform.audit.read',
    ],
  },
} as const satisfies Record<string, CustomRoleDefinition>;

export type TestRoleCode = SystemRoleCode | keyof typeof FORMER;

export const FORMER_ROLE_FIXTURES: readonly CustomRoleDefinition[] = Object.values(FORMER);

/** The custom role code standing for a former role (or the standard code itself). */
export function testRoleCode(code: TestRoleCode): string {
  return code in FORMER ? FORMER[code as keyof typeof FORMER].code : code;
}

/** Grants of the members holding `roles` (standard codes, or former codes as custom roles). */
export function testRoleGrants(
  roles: readonly TestRoleCode[],
  headedDepartmentIds: readonly string[] = [],
): Grant[] {
  return grantsForAssignments(
    roles.map((code) => ({ roleCode: testRoleCode(code) })),
    { headedDepartmentIds, customRoles: FORMER_ROLE_FIXTURES },
  );
}
