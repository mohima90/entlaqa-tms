import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { type TestRoleCode, testRoleGrants } from '../testing/former-roles';
import {
  AddGradeInput,
  GradeCode,
  addGradeActionDefinition,
  deleteGradeActionDefinition,
  gradesPageQueryDefinition,
  renameGradeActionDefinition,
} from './grades';

const db = vi.hoisted(() => ({
  listGradesWithPeople: vi.fn(),
  createGrade: vi.fn(),
  renameGrade: vi.fn(),
  deleteGrade: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const GRADE = '55555555-5555-4555-8555-555555555555';

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
    resolveResource: () => Promise.resolve(null),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the grade code as typed', () => {
  it('accepts numbers, letters with numbers and punctuation (PO 23 Oct 2026 #3)', () => {
    for (const good of ['7', 'G7', '#7', 'G-7', ' g7 ', '12.5', 'م٣']) {
      expect(GradeCode.safeParse(good).success, good).toBe(true);
    }
    expect(GradeCode.parse(' G7 ')).toBe('G7');
    // Digits are Latin whatever the keyboard.
    expect(GradeCode.parse('٧')).toBe('7');
    expect(GradeCode.parse('G۷')).toBe('G7');
  });

  it('refuses empty codes, spaces inside, punctuation only, invisible marks and long codes', () => {
    for (const bad of [
      '',
      '   ',
      'G 7',
      '---',
      '#',
      'A'.repeat(13),
      `G${String.fromCharCode(0x202e)}7`,
      `G${String.fromCharCode(0x200b)}7`,
      'G\t7',
    ]) {
      expect(GradeCode.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(AddGradeInput.safeParse({ code: 'G7', extra: 1 }).success).toBe(false);
  });
});

describe('the Grades page', () => {
  const page = (roles: TestRoleCode[]) =>
    createDefineQuery(runtime(roles).rt)(gradesPageQueryDefinition())({});

  it('HR and the Organization Admin read the list with the people on each grade', async () => {
    db.listGradesWithPeople.mockResolvedValue([{ id: GRADE, code: 'G7', people: 2 }]);
    for (const role of ['hr_manager', 'tenant_admin'] as const) {
      expect(await page([role])).toEqual(ok({ grades: [{ id: GRADE, code: 'G7', people: 2 }] }));
    }
  });

  it('everybody else is refused', async () => {
    for (const role of [
      'learner',
      'training_manager',
      'training_coordinator',
      'department_head',
      'line_manager',
      'auditor',
    ] as const) {
      const result = await page([role]);
      expect(!result.ok && result.error.code, role).toBe('FORBIDDEN');
    }
    expect(db.listGradesWithPeople).not.toHaveBeenCalled();
  });
});

describe('changing the list', () => {
  const run = (definition: unknown, roles: TestRoleCode[], input: unknown) => {
    const { rt, writeAudit } = runtime(roles);
    return {
      writeAudit,
      result: createDefineAction(rt)(definition as never)(input) as Promise<{
        ok: boolean;
        value?: unknown;
        error?: { code: string; fieldErrors?: { path: string; code: string }[] };
      }>,
    };
  };

  it('adds a grade and audits its code', async () => {
    db.createGrade.mockResolvedValue({ ok: true, id: GRADE, code: 'G-7' });
    const { result, writeAudit } = run(addGradeActionDefinition(), ['hr_manager'], {
      code: ' G-7 ',
    });
    expect(await result).toEqual(ok({ id: GRADE, code: 'G-7' }));
    expect(db.createGrade).toHaveBeenCalledWith(TX, 'G-7');
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.grade.created',
      entityType: 'grade',
      entityId: GRADE,
      data: { code: 'G-7' },
    });
  });

  it('answers on the field when the code is taken or not valid', async () => {
    db.createGrade.mockResolvedValue({ ok: false, refusal: 'taken' });
    const taken = await run(addGradeActionDefinition(), ['tenant_admin'], { code: 'G7' }).result;
    expect(taken.error?.code).toBe('VALIDATION_FAILED');
    expect(taken.error?.fieldErrors).toEqual([{ path: 'code', code: 'TAKEN' }]);
    db.createGrade.mockResolvedValue({ ok: false, refusal: 'invalid' });
    const invalid = await run(addGradeActionDefinition(), ['tenant_admin'], { code: 'G7' }).result;
    expect(invalid.error?.fieldErrors).toEqual([{ path: 'code', code: 'FORMAT' }]);
    const bad = await run(addGradeActionDefinition(), ['tenant_admin'], { code: 'G 7' }).result;
    expect(bad.error?.code).toBe('VALIDATION_FAILED');
  });

  it('renames (audit: from and to) and records nothing when the code is the same', async () => {
    db.renameGrade.mockResolvedValue({ ok: true, from: 'G7', to: 'G8', people: 3 });
    const renamed = run(renameGradeActionDefinition(), ['hr_manager'], { id: GRADE, code: 'G8' });
    expect(await renamed.result).toEqual(ok({ id: GRADE, from: 'G7', to: 'G8', people: 3 }));
    expect(renamed.writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.grade.renamed',
      entityType: 'grade',
      entityId: GRADE,
      data: { from: 'G7', to: 'G8' },
    });
    db.renameGrade.mockResolvedValue({ ok: true, from: 'G8', to: 'G8', people: 3 });
    const same = run(renameGradeActionDefinition(), ['hr_manager'], { id: GRADE, code: 'G8' });
    expect((await same.result).ok).toBe(true);
    expect(same.writeAudit).not.toHaveBeenCalled();
  });

  it('deletes an unused grade (audited) and refuses one people hold, with the reason', async () => {
    db.deleteGrade.mockResolvedValue({ ok: true, code: 'G9' });
    const deleted = run(deleteGradeActionDefinition(), ['tenant_admin'], { id: GRADE });
    expect(await deleted.result).toEqual(ok({ id: GRADE, code: 'G9' }));
    expect(deleted.writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.grade.deleted',
      entityType: 'grade',
      entityId: GRADE,
      data: { code: 'G9' },
    });
    db.deleteGrade.mockResolvedValue({ ok: false, refusal: 'in_use', people: 2 });
    const held = run(deleteGradeActionDefinition(), ['tenant_admin'], { id: GRADE });
    const refused = await held.result;
    expect(refused.error?.fieldErrors).toEqual([{ path: 'id', code: 'IN_USE' }]);
    expect(held.writeAudit).not.toHaveBeenCalled();
  });

  it('refuses members who do not keep the list — before the database is touched', async () => {
    for (const role of [
      'learner',
      'training_manager',
      'department_head',
      'line_manager',
    ] as const) {
      for (const [definition, input] of [
        [addGradeActionDefinition(), { code: 'G7' }],
        [renameGradeActionDefinition(), { id: GRADE, code: 'G8' }],
        [deleteGradeActionDefinition(), { id: GRADE }],
      ] as const) {
        const { result } = run(definition, [role], input);
        expect((await result).error?.code, role).toBe('FORBIDDEN');
      }
    }
    expect(db.createGrade).not.toHaveBeenCalled();
    expect(db.renameGrade).not.toHaveBeenCalled();
    expect(db.deleteGrade).not.toHaveBeenCalled();
  });

  it('maps the database refusing the member to FORBIDDEN and a missing grade to NOT_FOUND', async () => {
    db.renameGrade.mockResolvedValue({ ok: false, refusal: 'not_allowed' });
    expect(
      (await run(renameGradeActionDefinition(), ['hr_manager'], { id: GRADE, code: 'X' }).result)
        .error?.code,
    ).toBe('FORBIDDEN');
    db.deleteGrade.mockResolvedValue({ ok: false, refusal: 'not_found' });
    expect(
      (await run(deleteGradeActionDefinition(), ['hr_manager'], { id: GRADE }).result).error?.code,
    ).toBe('NOT_FOUND');
  });
});
