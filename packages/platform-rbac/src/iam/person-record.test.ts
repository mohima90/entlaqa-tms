import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { platformPermissions } from '../platform-permissions';
import { type TestRoleCode, testRoleGrants } from '../testing/former-roles';
import {
  EMPLOYMENT_CATEGORIES,
  GENDERS,
  HrDetailsInput,
  UpdatePersonRecordInput,
  loadPersonRecordEdit,
  loadPersonRecordView,
  updatePersonRecordActionDefinition,
} from './person-record';

const db = vi.hoisted(() => ({
  getPersonGrade: vi.fn(),
  listGrades: vi.fn(),
  getHrDetails: vi.fn(),
  setPersonGrade: vi.fn(),
  saveHrDetails: vi.fn(),
  insertAuditEvent: vi.fn(() => Promise.resolve()),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const SARA = '44444444-4444-4444-8444-444444444444';
const GRADE = '55555555-5555-4555-8555-555555555555';

function runtime(roles: TestRoleCode[], personId = ME) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const rt: ActionRuntime<UserTx> = {
    getClaims: () => {
      const r = brandVerifiedClaims({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        aal: 'aal1',
        tenant_id: TENANT,
        person_id: personId,
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

const HR = { gender: 'female', birthDate: '1992-05-14', employmentCategory: 'technical' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  db.getPersonGrade.mockResolvedValue(null);
  db.listGrades.mockResolvedValue([]);
  db.getHrDetails.mockResolvedValue(null);
});

describe('the input', () => {
  it('turns empty choices into null and refuses anything outside the fixed lists', () => {
    expect(UpdatePersonRecordInput.parse({ personId: SARA, gradeId: '' }).gradeId).toBeNull();
    expect(UpdatePersonRecordInput.parse({ personId: SARA }).gradeId).toBeUndefined();
    expect(HrDetailsInput.parse({ gender: '', birthDate: '', employmentCategory: '' })).toEqual({
      gender: null,
      birthDate: null,
      employmentCategory: null,
    });
    expect(
      HrDetailsInput.parse({
        gender: 'male',
        birthDate: '1980-01-31',
        employmentCategory: 'management',
      }),
    ).toEqual({
      gender: 'male',
      birthDate: '1980-01-31',
      employmentCategory: 'management',
    });
    for (const bad of [
      { gender: 'other', birthDate: '', employmentCategory: '' },
      { gender: '', birthDate: '31/01/1980', employmentCategory: '' },
      { gender: '', birthDate: '1800-01-01', employmentCategory: '' },
      { gender: '', birthDate: '', employmentCategory: 'executive' },
      { gender: '', birthDate: '', employmentCategory: '', salary: 1 },
    ]) {
      expect(HrDetailsInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(UpdatePersonRecordInput.safeParse({ personId: 'x' }).success).toBe(false);
    expect(UpdatePersonRecordInput.safeParse({ personId: SARA, gradeId: 'g7' }).success).toBe(
      false,
    );
    expect(UpdatePersonRecordInput.safeParse({ personId: SARA, extra: 1 }).success).toBe(false);
  });

  it('the lists are the fixed four categories and two genders of R1', () => {
    expect([...GENDERS]).toEqual(['male', 'female']);
    expect([...EMPLOYMENT_CATEGORIES]).toEqual([
      'management',
      'professional',
      'technical',
      'operational',
    ]);
  });
});

describe('who sees which section of a person (the database already filters the rows)', () => {
  const view = (roles: TestRoleCode[], personId: string, target = SARA) =>
    createDefineQuery(runtime(roles, personId).rt)({
      permission: platformPermissions['platform.user.read'],
      input: UpdatePersonRecordInput.pick({ personId: true }),
      scoped: true,
      handler: async ({ ctx, input }) => ok(await loadPersonRecordView(ctx, input.personId)),
    })({ personId: target });

  it('HR sees the grade row (even empty) and the HR-only card', async () => {
    db.getHrDetails.mockResolvedValue(HR);
    const result = await view(['hr_manager'], ME);
    expect(result.ok && result.value).toEqual({
      grade: { code: null },
      hr: { details: HR, own: false },
    });
  });

  it('the Organization Admin sees the grade but never the HR-only card — and nothing is read for it', async () => {
    db.getPersonGrade.mockResolvedValue({ id: GRADE, code: 'G7' });
    const result = await view(['tenant_admin'], ME);
    expect(result.ok && result.value).toEqual({ grade: { code: 'G7' }, hr: null });
    expect(db.getHrDetails).not.toHaveBeenCalled();
  });

  it('the person sees their own grade and HR details read-only', async () => {
    db.getHrDetails.mockResolvedValue(HR);
    const result = await view(['learner'], SARA);
    expect(result.ok && result.value).toEqual({
      grade: { code: null },
      hr: { details: HR, own: true },
    });
  });

  it('a manager sees the grade only when the database returned it; an L&D Manager sees neither', async () => {
    db.getPersonGrade.mockResolvedValue({ id: GRADE, code: '7' });
    const manager = await view(['line_manager'], ME);
    expect(manager.ok && manager.value).toEqual({ grade: { code: '7' }, hr: null });
    db.getPersonGrade.mockResolvedValue(null);
    const training = await view(['training_manager'], ME);
    expect(training.ok && training.value).toEqual({ grade: null, hr: null });
    expect(db.getHrDetails).not.toHaveBeenCalled();
  });

  it('the edit panel carries HR values only for who may edit them', async () => {
    db.getHrDetails.mockResolvedValue(HR);
    db.getPersonGrade.mockResolvedValue({ id: GRADE, code: 'G7' });
    db.listGrades.mockResolvedValue([{ id: GRADE, code: 'G7' }]);
    const edit = (roles: TestRoleCode[]) =>
      createDefineQuery(runtime(roles).rt)({
        permission: platformPermissions['platform.user.update'],
        input: UpdatePersonRecordInput.pick({ personId: true }),
        resource: (input) => ({ type: 'person', id: input.personId }),
        handler: async ({ ctx, input }) => ok(await loadPersonRecordEdit(ctx, input.personId)),
      })({ personId: SARA });
    const hr = await edit(['hr_manager']);
    expect(hr.ok && hr.value).toEqual({
      gradeId: GRADE,
      grades: [{ id: GRADE, code: 'G7' }],
      hr: HR,
      canEditHr: true,
    });
    const admin = await edit(['tenant_admin']);
    expect(admin.ok && admin.value.hr).toBeNull();
    expect(admin.ok && admin.value.canEditHr).toBe(false);
  });
});

describe('saving a person’s grade and HR-only fields', () => {
  const save = (roles: TestRoleCode[], input: unknown) => {
    const { rt, writeAudit } = runtime(roles);
    return {
      writeAudit,
      run: () => createDefineAction(rt)(updatePersonRecordActionDefinition())(input as never),
    };
  };

  it('HR sets the grade and the HR fields; the audit names the fields, never the values', async () => {
    db.setPersonGrade.mockResolvedValue({
      ok: true,
      change: { changed: true, from: null, to: 'G7' },
    });
    db.saveHrDetails.mockResolvedValue({ ok: true, changed: ['gender', 'birthDate'] });
    const { run, writeAudit } = save(['hr_manager'], { personId: SARA, gradeId: GRADE, hr: HR });
    expect(await run()).toEqual(
      ok({
        personId: SARA,
        grade: { changed: true, from: null, to: 'G7' },
        hrChanged: ['gender', 'birthDate'],
      }),
    );
    expect(db.setPersonGrade).toHaveBeenCalledWith(TX, SARA, GRADE);
    expect(db.saveHrDetails).toHaveBeenCalledWith(TX, SARA, HR);
    // The grade change is its own audit event (codes), the HR change records field names and «hidden».
    expect(db.insertAuditEvent).toHaveBeenCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({
        action: 'platform.person.grade_changed',
        entityId: SARA,
        data: { from: null, to: 'G7' },
      }),
    );
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.person.hr_details_changed',
      entityType: 'person',
      entityId: SARA,
      data: { changed: ['gender', 'birthDate'], value: 'hidden' },
    });
    const recorded = JSON.stringify([writeAudit.mock.calls, db.insertAuditEvent.mock.calls]);
    expect(recorded).not.toContain('1992');
    expect(recorded).not.toContain('female');
  });

  it('records nothing when nothing changed', async () => {
    db.setPersonGrade.mockResolvedValue({
      ok: true,
      change: { changed: false, from: 'G7', to: 'G7' },
    });
    db.saveHrDetails.mockResolvedValue({ ok: true, changed: [] });
    const { run, writeAudit } = save(['hr_manager'], { personId: SARA, gradeId: GRADE, hr: HR });
    expect((await run()).ok).toBe(true);
    expect(db.insertAuditEvent).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('the Organization Admin sets the grade but is refused the HR-only fields (nothing saved)', async () => {
    db.setPersonGrade.mockResolvedValue({
      ok: true,
      change: { changed: true, from: 'G7', to: null },
    });
    const grade = save(['tenant_admin'], { personId: SARA, gradeId: '' });
    expect((await grade.run()).ok).toBe(true);
    expect(db.setPersonGrade).toHaveBeenCalledWith(TX, SARA, null);
    const hr = save(['tenant_admin'], { personId: SARA, hr: HR });
    const refused = await hr.run();
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    expect(db.saveHrDetails).not.toHaveBeenCalled();
  });

  it('a member without user.update, and a person outside the scope, are refused before anything is read', async () => {
    for (const roles of [['learner'], ['training_manager'], ['line_manager']] as TestRoleCode[][]) {
      const result = await save(roles, { personId: SARA, gradeId: GRADE }).run();
      expect(!result.ok && result.error.code, roles.join()).toMatch(/FORBIDDEN|NOT_FOUND/);
    }
    expect(db.setPersonGrade).not.toHaveBeenCalled();
    expect(db.saveHrDetails).not.toHaveBeenCalled();
  });

  it('answers on the field: an unknown grade and an impossible date of birth', async () => {
    db.setPersonGrade.mockResolvedValue({ ok: false, refusal: 'invalid' });
    const grade = await save(['hr_manager'], { personId: SARA, gradeId: GRADE }).run();
    expect(!grade.ok && grade.error.code).toBe('VALIDATION_FAILED');
    expect(!grade.ok && grade.error.fieldErrors).toEqual([{ path: 'gradeId', code: 'INVALID' }]);
    db.saveHrDetails.mockResolvedValue({ ok: false, refusal: 'birth_date_invalid' });
    const date = await save(['hr_manager'], { personId: SARA, hr: HR }).run();
    expect(!date.ok && date.error.fieldErrors).toEqual([{ path: 'birthDate', code: 'INVALID' }]);
  });

  it('maps the database refusing the member to FORBIDDEN', async () => {
    db.setPersonGrade.mockResolvedValue({ ok: false, refusal: 'not_allowed' });
    const result = await save(['hr_manager'], { personId: SARA, gradeId: GRADE }).run();
    expect(!result.ok && result.error.code).toBe('FORBIDDEN');
    db.saveHrDetails.mockResolvedValue({ ok: false, refusal: 'not_found' });
    const gone = await save(['hr_manager'], { personId: SARA, hr: HR }).run();
    expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
  });
});
