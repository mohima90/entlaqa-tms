import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  type UserDetailsChange,
  getEditableUser,
  listManagerOptions,
  mayManagePerson,
  refusalOf,
  updateUserDetails,
} from './user-admin';

const dialect = new PgDialect();

function fakeTx(...results: (unknown[] | Error)[]) {
  const executed: string[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        executed.push(dialect.sqlToQuery(query).sql);
        const next = results.shift() ?? [];
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    } as never,
  };
}

const row = {
  id: 'p1',
  first_name_ar: 'سارة',
  father_name_ar: null,
  grandfather_name_ar: null,
  family_name_ar: null,
  first_name_en: null,
  father_name_en: null,
  grandfather_name_en: null,
  family_name_en: null,
  display_name_ar: 'سارة',
  display_name_en: null,
  email: 's@example.test',
  mobile_e164: null,
  employee_number: null,
  preferred_locale: 'ar',
  person_version: 3,
  has_login: false,
  department_id: null,
  branch_id: null,
  manager_person_id: null,
  job_title_ar: null,
  job_title_en: null,
  hire_on: null,
  employment_version: 0,
  may_manage: true,
};

const change = (over: Partial<UserDetailsChange> = {}): UserDetailsChange => ({
  firstNameAr: 'سارة',
  fatherNameAr: null,
  grandfatherNameAr: null,
  familyNameAr: null,
  firstNameEn: null,
  fatherNameEn: null,
  grandfatherNameEn: null,
  familyNameEn: null,
  displayNameAr: 'سارة',
  displayNameEn: null,
  email: 's@example.test',
  mobileE164: null,
  employeeNumber: null,
  preferredLocale: 'ar',
  departmentId: null,
  branchId: null,
  managerPersonId: null,
  jobTitleAr: null,
  jobTitleEn: null,
  hireOn: null,
  ...over,
});

const pgError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('db'), { cause: { code, message: '', ...extra } });

describe('getEditableUser / listManagerOptions', () => {
  it('maps the row and the version token; null when absent', async () => {
    expect(await getEditableUser(fakeTx([row]).tx, 'p1')).toMatchObject({
      personId: 'p1',
      version: '3:0',
      mayManage: true,
      hasLogin: false,
      preferredLocale: 'ar',
    });
    expect(await getEditableUser(fakeTx([]).tx, 'p1')).toBeNull();
  });

  it('lists managers with their departments', async () => {
    expect(
      await listManagerOptions(
        fakeTx([{ person_id: 'm', name_ar: 'م', name_en: null, department_ids: null }]).tx,
      ),
    ).toEqual([{ personId: 'm', nameAr: 'م', nameEn: null, departmentIds: [] }]);
  });
});

describe('mayManagePerson', () => {
  it('asks the database rule; unknown person → false', async () => {
    expect(await mayManagePerson(fakeTx([{ may: true }]).tx, 'p1')).toBe(true);
    expect(await mayManagePerson(fakeTx([]).tx, 'p1')).toBe(false);
  });
});

describe('updateUserDetails', () => {
  it('no change → nothing written', async () => {
    const fake = fakeTx([row]);
    expect(await updateUserDetails(fake.tx, 'p1', '3:0', change())).toEqual({
      ok: true,
      changed: [],
    });
    expect(fake.executed).toHaveLength(1);
  });

  it('updates the person with a version check and creates the first placement', async () => {
    const fake = fakeTx([row], [{ id: 'p1' }], []);
    const outcome = await updateUserDetails(
      fake.tx,
      'p1',
      '3:0',
      change({ mobileE164: '+966500000000', departmentId: 'd1' }),
    );
    expect(outcome).toEqual({ ok: true, changed: ['mobileE164', 'departmentId'] });
    expect(fake.executed[1]).toContain('and version = $');
    expect(fake.executed[2]).toContain('insert into platform.person_employment');
  });

  it('updates an existing placement; a concurrent edit is a version conflict', async () => {
    const placed = { ...row, employment_version: 2, department_id: 'd1' };
    const ok = fakeTx([placed], [{ id: 'e1' }]);
    expect(await updateUserDetails(ok.tx, 'p1', '3:2', change({ departmentId: 'd2' }))).toEqual({
      ok: true,
      changed: ['departmentId'],
    });
    expect(ok.executed[1]).toContain('update platform.person_employment');
    const raced = fakeTx([placed], []);
    expect(await updateUserDetails(raced.tx, 'p1', '3:2', change({ departmentId: 'd2' }))).toEqual({
      ok: false,
      refusal: 'version_conflict',
    });
    expect(await updateUserDetails(fakeTx([row]).tx, 'p1', '2:0', change())).toEqual({
      ok: false,
      refusal: 'version_conflict',
    });
  });

  it('keeps the login e-mail of a person with a login', async () => {
    const fake = fakeTx([{ ...row, has_login: true }]);
    expect(
      await updateUserDetails(fake.tx, 'p1', '3:0', change({ email: 'other@example.test' })),
    ).toEqual({ ok: true, changed: [] });
  });

  it('turns database refusals into reasons and rethrows anything else', async () => {
    expect(
      await updateUserDetails(
        fakeTx([row], pgError('23505', { constraint_name: 'persons_tenant_email_uq' })).tx,
        'p1',
        '3:0',
        change({ email: 'x@example.test' }),
      ),
    ).toEqual({ ok: false, refusal: 'email_taken' });
    expect(
      refusalOf(pgError('23505', { constraint_name: 'persons_tenant_employee_number_uq' })),
    ).toBe('employee_number_taken');
    expect(
      refusalOf(pgError('23514', { message: 'the manager chain of person x would loop' })),
    ).toBe('manager_loop');
    expect(
      refusalOf(pgError('23514', { message: 'the direct manager must be an active person' })),
    ).toBe('manager_inactive');
    expect(refusalOf(pgError('23514', { message: 'cannot be placed in a deleted branch' }))).toBe(
      'unit_deleted',
    );
    expect(refusalOf(pgError('42501'))).toBe('not_allowed');
    expect(() => refusalOf(new Error('boom'))).toThrow('boom');
    expect(await updateUserDetails(fakeTx([]).tx, 'p1', '1:0', change())).toEqual({
      ok: false,
      refusal: 'not_found',
    });
  });
});
