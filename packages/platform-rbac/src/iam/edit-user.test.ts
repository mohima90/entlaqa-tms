import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { type TestRoleCode, testRoleGrants } from '../testing/former-roles';
import {
  EditUserInput,
  editUserQueryDefinition,
  updateUserDetailsActionDefinition,
} from './edit-user';

const db = vi.hoisted(() => ({
  getEditableUser: vi.fn(),
  listManagerOptions: vi.fn(),
  listOrgUnitOptions: vi.fn(),
  updateUserDetails: vi.fn(),
  getTenantDefaultLocale: vi.fn(),
  keepsUnsplitDisplayName: vi.fn(),
  listStructureLevelLabels: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const SARA = '44444444-4444-4444-8444-444444444444';
const DEPT = '55555555-5555-4555-8555-555555555555';

function runtime(roles: TestRoleCode[]) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const rt: ActionRuntime<UserTx> = {
    getClaims: () => {
      const r = brandVerifiedClaims({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        aal: 'aal1',
        tenant_id: TENANT,
        person_id: ME,
      });
      if (!r.ok) throw new Error('fixture');
      return Promise.resolve(ok(r.value));
    },
    withUserTx: (_c, fn) => fn(TX),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: true }),
    loadGrants: () => Promise.resolve(testRoleGrants(roles, [])),
    resolveResource: (_tx, ref) =>
      Promise.resolve(
        ref.id === SARA
          ? { type: 'person', id: SARA, tenantId: TENANT, subjectPersonId: SARA }
          : null,
      ),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit };
}

const form = {
  personId: SARA,
  version: '3:1',
  firstNameAr: 'سارة',
  fatherNameAr: '',
  grandfatherNameAr: '',
  familyNameAr: 'القحطاني',
  firstNameEn: 'Sarah',
  fatherNameEn: '',
  grandfatherNameEn: '',
  familyNameEn: 'Alqahtani',
  email: 'Sara@Example.test',
  mobile: '',
  employeeNumber: ' EMP-' + String.fromCharCode(0x0661, 0x0661, 0x0668, 0x0667),
  preferredLocale: 'ar' as const,
  departmentId: DEPT,
  branchId: '',
  managerPersonId: '',
  jobTitleAr: 'أخصائية تدريب',
  jobTitleEn: '',
  hireOn: '2024-03-03',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.listManagerOptions.mockResolvedValue([
    { personId: SARA, nameAr: 'س', nameEn: null, departmentIds: [] },
    { personId: ME, nameAr: 'م', nameEn: null, departmentIds: [DEPT] },
  ]);
  db.listOrgUnitOptions.mockResolvedValue({ departments: [], branches: [] });
  db.getTenantDefaultLocale.mockResolvedValue('ar');
  db.keepsUnsplitDisplayName.mockReturnValue(false);
});

describe('edit user input', () => {
  it('normalizes and refuses the person as their own manager', () => {
    const parsed = EditUserInput.parse(form);
    expect(parsed).toMatchObject({
      email: 'sara@example.test',
      employeeNumber: 'EMP-1187',
      branchId: null,
      managerPersonId: null,
      hireOn: '2024-03-03',
      fatherNameAr: null,
    });
    for (const bad of [
      { ...form, managerPersonId: SARA },
      { ...form, email: 'not-an-email' },
      { ...form, hireOn: '03/03/2024' },
      { ...form, version: 'x' },
      { ...form, departmentId: 'd1' },
      { ...form, status: 'inactive' },
      { ...form, hireOn: '0001-01-01' },
      { ...form, hireOn: '9999-12-31' },
    ]) {
      expect(EditUserInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('edit user query', () => {
  it('Organization Admin: the record, managers (without the person) and org units', async () => {
    db.getEditableUser.mockResolvedValue({ personId: SARA, mayManage: true });
    const result = await createDefineQuery(runtime(['tenant_admin']).rt)(editUserQueryDefinition())(
      { personId: SARA },
    );
    expect(result.ok && result.value.managers.map((m) => m.personId)).toEqual([ME]);
  });

  it('a record the member may not manage → FORBIDDEN; no user.update → FORBIDDEN', async () => {
    db.getEditableUser.mockResolvedValue({ personId: SARA, mayManage: false });
    const hr = await createDefineQuery(runtime(['hr_manager']).rt)(editUserQueryDefinition())({
      personId: SARA,
    });
    expect(!hr.ok && hr.error.code).toBe('FORBIDDEN');
    const learner = await createDefineQuery(runtime(['learner']).rt)(editUserQueryDefinition())({
      personId: SARA,
    });
    expect(!learner.ok && learner.error.code).toBe('FORBIDDEN');
    db.getEditableUser.mockResolvedValue(null);
    const gone = await createDefineQuery(runtime(['tenant_admin']).rt)(editUserQueryDefinition())({
      personId: SARA,
    });
    expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
  });
});

describe('update user details', () => {
  it('saves with composed display names and audits the changed field names', async () => {
    db.updateUserDetails.mockResolvedValue({ ok: true, changed: ['familyNameAr', 'departmentId'] });
    const { rt, writeAudit } = runtime(['hr_manager']);
    const result = await createDefineAction(rt)(updateUserDetailsActionDefinition())(form);
    expect(result).toEqual(ok({ personId: SARA, changed: ['familyNameAr', 'departmentId'] }));
    expect(db.updateUserDetails).toHaveBeenCalledWith(
      TX,
      SARA,
      '3:1',
      expect.objectContaining({
        displayNameAr: 'سارة القحطاني',
        displayNameEn: 'Sarah Alqahtani',
        employeeNumber: 'EMP-1187',
      }),
    );
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.user.updated',
      entityType: 'person',
      entityId: SARA,
      data: { changed: ['familyNameAr', 'departmentId'] },
    });
  });

  it('the required names follow the organization’s default language (guided-test feedback #2)', async () => {
    db.getEditableUser.mockResolvedValue({
      personId: SARA,
      mayManage: true,
      displayNameAr: 'سارة',
    });
    db.updateUserDetails.mockResolvedValue({ ok: true, changed: ['firstNameEn'] });
    const save = createDefineAction(runtime(['tenant_admin']).rt)(
      updateUserDetailsActionDefinition(),
    );
    db.getTenantDefaultLocale.mockResolvedValue('en');
    const noFamily = await save({ ...form, familyNameEn: '' });
    expect(!noFamily.ok && noFamily.error.fieldErrors).toEqual([
      { path: 'familyNameEn', code: 'REQUIRED' },
    ]);
    expect(db.updateUserDetails).not.toHaveBeenCalled();
    const englishOnly = await save({
      ...form,
      firstNameAr: '',
      familyNameAr: '',
      familyNameEn: 'Alqahtani',
    });
    expect(englishOnly.ok).toBe(true);
    expect(db.updateUserDetails).toHaveBeenCalledWith(
      TX,
      SARA,
      '3:1',
      expect.objectContaining({ displayNameAr: null, displayNameEn: 'Sarah Alqahtani' }),
    );
    // The database's last word (no name at all) points at the required language's first name.
    db.updateUserDetails.mockResolvedValue({ ok: false, refusal: 'name_required' });
    const refused = await save({ ...form, familyNameEn: 'Alqahtani' });
    expect(!refused.ok && refused.error.fieldErrors?.[0]?.path).toBe('firstNameEn');
    // The optional language's names all or nothing (WP-FIX-01 review): half an English name is refused.
    db.getTenantDefaultLocale.mockResolvedValue('ar');
    const half = await save({ ...form, familyNameEn: '' });
    expect(!half.ok && half.error.fieldErrors).toEqual([
      { path: 'familyNameEn', code: 'REQUIRED' },
    ]);
  });

  it('maps refusals to field errors or clear errors; no change → no audit', async () => {
    const cases: [string, string, string | undefined][] = [
      ['email_taken', 'VALIDATION_FAILED', 'email'],
      ['employee_number_taken', 'VALIDATION_FAILED', 'employeeNumber'],
      ['manager_loop', 'VALIDATION_FAILED', 'managerPersonId'],
      ['manager_inactive', 'VALIDATION_FAILED', 'managerPersonId'],
      ['department_deleted', 'VALIDATION_FAILED', 'departmentId'],
      ['branch_deleted', 'VALIDATION_FAILED', 'branchId'],
      ['hire_date_invalid', 'VALIDATION_FAILED', 'hireOn'],
      ['name_required', 'VALIDATION_FAILED', 'firstNameAr'],
      ['version_conflict', 'CONFLICT_VERSION', undefined],
      ['not_allowed', 'FORBIDDEN', undefined],
      ['not_found', 'NOT_FOUND', undefined],
    ];
    for (const [refusal, code, path] of cases) {
      db.updateUserDetails.mockResolvedValue({ ok: false, refusal });
      const result = await createDefineAction(runtime(['tenant_admin']).rt)(
        updateUserDetailsActionDefinition(),
      )(form);
      expect(!result.ok && result.error.code, refusal).toBe(code);
      if (path) expect(!result.ok && result.error.fieldErrors?.[0]?.path).toBe(path);
    }
    db.updateUserDetails.mockResolvedValue({ ok: true, changed: [] });
    const { rt, writeAudit } = runtime(['tenant_admin']);
    await createDefineAction(rt)(updateUserDetailsActionDefinition())(form);
    expect(writeAudit).not.toHaveBeenCalled();
    // Another organization's person or one outside the scope: not found, nothing saved.
    db.updateUserDetails.mockClear();
    const other = await createDefineAction(runtime(['tenant_admin']).rt)(
      updateUserDetailsActionDefinition(),
    )({ ...form, personId: ME });
    expect(!other.ok && other.error.code).toBe('NOT_FOUND');
    expect(db.updateUserDetails).not.toHaveBeenCalled();
    const denied = await createDefineAction(runtime(['line_manager']).rt)(
      updateUserDetailsActionDefinition(),
    )(form);
    expect(!denied.ok && denied.error.code).toBe('FORBIDDEN');
  });
});
