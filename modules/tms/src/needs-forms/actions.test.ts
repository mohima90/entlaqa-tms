import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import {
  type ActionRuntime,
  createDefineAction,
  createDefineQuery,
  grantsForAssignments,
} from '@jadarat/platform-rbac';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testForm } from './test-form';

const db = vi.hoisted(() => {
  class NeedsFormRefused extends Error {
    constructor(readonly refusal: string) {
      super(refusal);
    }
  }
  return {
    NeedsFormRefused,
    needsFormRefusalOf: vi.fn((error: unknown) => {
      if (error instanceof NeedsFormRefused) return error.refusal;
      throw error;
    }),
    listNeedsForms: vi.fn(),
    getNeedsForm: vi.fn(),
    createNeedsForm: vi.fn(),
    duplicateNeedsForm: vi.fn(),
    renameNeedsForm: vi.fn(),
    setDefaultNeedsForm: vi.fn(),
    setNeedsFormActive: vi.fn(),
    deleteNeedsForm: vi.fn(),
    writeSection: vi.fn(),
    deleteSection: vi.fn(),
    orderSections: vi.fn(),
    orderFields: vi.fn(),
    writeField: vi.fn(),
    deleteField: vi.fn(),
  };
});
vi.mock('../db/needs-forms', () => db);

const actions = await import('./actions');

const TX = 'tx' as unknown as UserTx;
const FORM = '0c000000-0000-4000-8000-000000000001';
const SECTION = '0c000000-0000-4000-8000-0000000000a1';
const FIELD = '0c000000-0000-4000-8000-0000000000b1';

/** A form whose ids are uuids, as the database returns them. */
function uuidForm(over = {}) {
  const base = testForm({ id: FORM, ...over });
  const [needs, extra] = base.sections;
  if (!needs || !extra) throw new Error('fixture');
  return {
    ...base,
    sections: [
      {
        ...needs,
        id: SECTION,
        fields: needs.fields
          .map((f) => (f.id === 'level' ? { ...f, id: FIELD } : f))
          .map((f) =>
            f.condition?.fieldId === 'level'
              ? { ...f, condition: { ...f.condition, fieldId: FIELD } }
              : f,
          ),
      },
      extra,
    ],
  };
}

function runtime(role: string | null) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const rt: ActionRuntime<UserTx> = {
    getClaims: () => {
      const r = brandVerifiedClaims({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        aal: 'aal1',
        tenant_id: '22222222-2222-4222-8222-222222222222',
        person_id: '33333333-3333-4333-8333-333333333333',
      });
      if (!r.ok) throw new Error('fixture');
      return Promise.resolve(ok(r.value));
    },
    withUserTx: (_c, fn) => fn(TX),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: false }),
    loadGrants: () =>
      Promise.resolve(
        role ? grantsForAssignments([{ roleCode: role }], { headedDepartmentIds: ['d1'] }) : [],
      ),
    resolveResource: () => Promise.resolve(null),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit };
}

const summaries = [
  {
    id: FORM,
    name: { en: 'Form', ar: 'نموذج' },
    isDefault: false,
    isActive: true,
    lockedAt: null,
    version: 1,
    sectionCount: 2,
    fieldCount: 13,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  db.listNeedsForms.mockResolvedValue(summaries);
  db.getNeedsForm.mockResolvedValue(uuidForm());
  db.createNeedsForm.mockResolvedValue(FORM);
  db.duplicateNeedsForm.mockResolvedValue(FORM);
});

const names = { nameEn: 'Engineering needs', nameAr: 'احتياجات الهندسة' };

describe('who reads and designs needs forms (T-M3-10)', () => {
  it('the L&D Manager reads the library and designs; the Training Coordinator reads only', async () => {
    const lnd = runtime('training_manager');
    expect(await createDefineQuery(lnd.rt)(actions.needsFormsLibraryQueryDefinition())({})).toEqual(
      ok({ forms: summaries, canManage: true }),
    );
    const tc = runtime('training_coordinator');
    expect(
      await createDefineQuery(tc.rt)(actions.needsFormQueryDefinition())({ formId: FORM }),
    ).toEqual(ok({ form: uuidForm(), canManage: false }));
    const refused = await createDefineAction(tc.rt)(actions.createNeedsFormActionDefinition())(
      names,
    );
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    expect(db.createNeedsForm).not.toHaveBeenCalled();
  });

  it('refuses the Organization Admin, the HR Manager, the Department Head and the Employee (deny by default)', async () => {
    for (const role of ['tenant_admin', 'hr_manager', 'department_head', 'learner', null]) {
      const { rt } = runtime(role);
      const read = await createDefineQuery(rt)(actions.needsFormsLibraryQueryDefinition())({});
      expect(!read.ok && read.error.code, String(role)).toBe('FORBIDDEN');
      const write = await createDefineAction(rt)(actions.deleteNeedsFormActionDefinition())({
        formId: FORM,
      });
      expect(!write.ok && write.error.code, String(role)).toBe('FORBIDDEN');
    }
    expect(db.listNeedsForms).not.toHaveBeenCalled();
    expect(db.deleteNeedsForm).not.toHaveBeenCalled();
  });

  it('validates input before anything else', async () => {
    const { rt } = runtime('training_manager');
    const bad = await createDefineAction(rt)(actions.createNeedsFormActionDefinition())({
      nameEn: ' ',
      nameAr: 'x'.repeat(121),
    });
    expect(!bad.ok && bad.error.code).toBe('VALIDATION_FAILED');
    const notUuid = await createDefineQuery(rt)(actions.needsFormQueryDefinition())({
      formId: "1' or '1'='1",
    });
    expect(!notUuid.ok && notUuid.error.code).toBe('VALIDATION_FAILED');
    expect(db.getNeedsForm).not.toHaveBeenCalled();
  });
});

describe('the library', () => {
  it('creates, duplicates, renames, sets the default and switches forms off — audited', async () => {
    const { rt, writeAudit } = runtime('training_manager');
    const run = createDefineAction(rt);
    expect(await run(actions.createNeedsFormActionDefinition())(names)).toEqual(
      ok({ formId: FORM, forms: summaries }),
    );
    expect(db.createNeedsForm).toHaveBeenCalledWith(TX, names);
    expect(writeAudit).toHaveBeenLastCalledWith(TX, expect.anything(), {
      action: 'tms.needs_form.created',
      entityType: 'needs_form',
      entityId: FORM,
      data: {},
    });
    await run(actions.duplicateNeedsFormActionDefinition())({ formId: FORM, ...names });
    expect(writeAudit).toHaveBeenLastCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({
        action: 'tms.needs_form.duplicated',
        data: { sourceFormId: FORM },
      }),
    );
    await run(actions.renameNeedsFormActionDefinition())({ formId: FORM, version: 1, ...names });
    expect(db.renameNeedsForm).toHaveBeenCalledWith(TX, FORM, 1, {
      formId: FORM,
      version: 1,
      ...names,
    });
    await run(actions.setDefaultNeedsFormActionDefinition())({ formId: FORM });
    expect(db.setDefaultNeedsForm).toHaveBeenCalledWith(TX, FORM);
    await run(actions.setNeedsFormActiveActionDefinition())({ formId: FORM, active: false });
    expect(db.setNeedsFormActive).toHaveBeenCalledWith(TX, FORM, false);
    expect(await run(actions.deleteNeedsFormActionDefinition())({ formId: FORM })).toEqual(
      ok({ formId: FORM, forms: summaries }),
    );
  });

  it('refuses switching off or deleting the default form, deleting a locked one, unknown forms', async () => {
    const { rt } = runtime('training_manager');
    const run = createDefineAction(rt);
    db.listNeedsForms.mockResolvedValue([{ ...summaries[0], isDefault: true }]);
    const off = await run(actions.setNeedsFormActiveActionDefinition())({
      formId: FORM,
      active: false,
    });
    expect(!off.ok && off.error.fieldErrors).toEqual([{ path: 'form', code: 'DEFAULT_FORM' }]);
    const del = await run(actions.deleteNeedsFormActionDefinition())({ formId: FORM });
    expect(!del.ok && del.error.fieldErrors).toEqual([{ path: 'form', code: 'DEFAULT_FORM' }]);
    db.listNeedsForms.mockResolvedValue([
      { ...summaries[0], lockedAt: '2026-11-01T00:00:00.000Z' },
    ]);
    const locked = await run(actions.deleteNeedsFormActionDefinition())({ formId: FORM });
    expect(!locked.ok && locked.error.fieldErrors).toEqual([
      { path: 'form', code: 'NEEDS_FORM_LOCKED' },
    ]);
    db.listNeedsForms.mockResolvedValue([]);
    const gone = await run(actions.deleteNeedsFormActionDefinition())({ formId: FORM });
    expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
    const goneActive = await run(actions.setNeedsFormActiveActionDefinition())({
      formId: FORM,
      active: true,
    });
    expect(!goneActive.ok && goneActive.error.code).toBe('NOT_FOUND');
    db.duplicateNeedsForm.mockResolvedValue(null);
    const copy = await run(actions.duplicateNeedsFormActionDefinition())({
      formId: FORM,
      ...names,
    });
    expect(!copy.ok && copy.error.code).toBe('NOT_FOUND');
    expect(db.deleteNeedsForm).not.toHaveBeenCalled();
  });

  it('maps the database refusals to the screen’s errors', async () => {
    const { rt } = runtime('training_manager');
    const run = createDefineAction(rt);
    const cases: [string, unknown][] = [
      ['name_en_taken', { fieldErrors: [{ path: 'nameEn', code: 'NAME_TAKEN' }] }],
      ['name_ar_taken', { fieldErrors: [{ path: 'nameAr', code: 'NAME_TAKEN' }] }],
      ['version_conflict', { code: 'CONFLICT_VERSION' }],
      ['not_allowed', { code: 'FORBIDDEN' }],
      ['not_found', { code: 'NOT_FOUND' }],
      ['locked', { fieldErrors: [{ path: 'form', code: 'NEEDS_FORM_LOCKED' }] }],
      ['system', { fieldErrors: [{ path: 'field', code: 'SYSTEM_FIELD' }] }],
      ['default', { fieldErrors: [{ path: 'form', code: 'DEFAULT_FORM' }] }],
      ['condition', { fieldErrors: [{ path: 'condition', code: 'CONDITION_FIELD' }] }],
      ['limit', { fieldErrors: [{ path: 'form', code: 'TOO_MANY' }] }],
    ];
    for (const [refusal, expected] of cases) {
      db.renameNeedsForm.mockRejectedValueOnce(new db.NeedsFormRefused(refusal));
      const result = await run(actions.renameNeedsFormActionDefinition())({
        formId: FORM,
        version: 1,
        ...names,
      });
      expect(!result.ok && result.error, refusal).toMatchObject(expected as object);
    }
    // Anything else stays internal (logged with a correlation id).
    db.renameNeedsForm.mockRejectedValueOnce(new Error('boom'));
    const internal = await run(actions.renameNeedsFormActionDefinition())({
      formId: FORM,
      version: 1,
      ...names,
    });
    expect(!internal.ok && internal.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('the builder', () => {
  const sectionInput = {
    formId: FORM,
    nameEn: 'Context',
    nameAr: 'السياق',
    descriptionEn: '',
    descriptionAr: '',
    repeatable: false,
    minEntries: 1,
    maxEntries: 1,
  };
  const fieldInput = {
    formId: FORM,
    sectionId: SECTION,
    type: 'select' as const,
    labelEn: 'Venue',
    labelAr: 'المكان',
    placeholderEn: '',
    placeholderAr: '',
    required: true,
    options: [{ labelEn: 'Riyadh', labelAr: 'الرياض' }],
    peopleMode: null,
    condition: { fieldId: FIELD, value: 'advanced' },
  };

  it('applies each change with the rules, writes it and returns the form read back', async () => {
    const { rt, writeAudit } = runtime('training_manager');
    const run = createDefineAction(rt);
    expect(await run(actions.saveSectionActionDefinition())(sectionInput)).toEqual(
      ok({ form: uuidForm() }),
    );
    expect(db.getNeedsForm).toHaveBeenNthCalledWith(1, TX, FORM, { forUpdate: true });
    expect(db.writeSection).toHaveBeenCalledWith(
      TX,
      FORM,
      expect.objectContaining({ name: { en: 'Context', ar: 'السياق' } }),
      true,
    );
    await run(actions.saveSectionActionDefinition())({
      ...sectionInput,
      sectionId: SECTION,
      repeatable: true,
      minEntries: 1,
      maxEntries: 5,
    });
    expect(db.writeSection).toHaveBeenLastCalledWith(
      TX,
      FORM,
      expect.objectContaining({ id: SECTION, maxEntries: 5 }),
      false,
    );
    await run(actions.saveFieldActionDefinition())(fieldInput);
    expect(db.writeField).toHaveBeenCalledWith(
      TX,
      FORM,
      SECTION,
      expect.objectContaining({
        type: 'select',
        options: [{ value: 'riyadh', label: { en: 'Riyadh', ar: 'الرياض' } }],
        condition: { fieldId: FIELD, value: 'advanced' },
      }),
      true,
    );
    expect(writeAudit).toHaveBeenLastCalledWith(TX, expect.anything(), {
      action: 'tms.needs_form.field_saved',
      entityType: 'needs_form',
      entityId: FORM,
      data: { sectionId: SECTION, fieldId: null, type: 'select' },
    });
    await run(actions.saveFieldActionDefinition())({
      ...fieldInput,
      fieldId: FIELD,
      type: 'select' as const,
      condition: null,
      options: [
        { value: 'basic', labelEn: 'Basic', labelAr: 'أساسي' },
        { value: 'advanced', labelEn: 'Advanced', labelAr: 'متقدم' },
      ],
    });
    expect(db.writeField).toHaveBeenLastCalledWith(
      TX,
      FORM,
      SECTION,
      expect.objectContaining({ id: FIELD }),
      false,
    );
    await run(actions.setSectionVisibleActionDefinition())({
      formId: FORM,
      sectionId: SECTION,
      visible: true,
    });
    await run(actions.moveSectionActionDefinition())({
      formId: FORM,
      sectionId: SECTION,
      direction: 'down',
    });
    expect(db.orderSections).toHaveBeenCalledWith(TX, FORM, ['extra', SECTION]);
    await run(actions.moveFieldActionDefinition())({
      formId: FORM,
      fieldId: FIELD,
      direction: 'up',
    });
    expect(db.orderFields).toHaveBeenCalledWith(TX, SECTION, [
      'topic',
      FIELD,
      'people',
      'details',
      'track',
    ]);
    await run(actions.setFieldVisibleActionDefinition())({
      formId: FORM,
      fieldId: FIELD,
      visible: false,
    });
    await run(actions.setFieldRequiredActionDefinition())({
      formId: FORM,
      fieldId: FIELD,
      required: true,
    });
    expect(db.writeField).toHaveBeenLastCalledWith(
      TX,
      FORM,
      SECTION,
      expect.objectContaining({ id: FIELD, required: true }),
      false,
    );
    await run(actions.deleteFieldActionDefinition())({ formId: FORM, fieldId: FIELD });
    expect(db.deleteField).toHaveBeenCalledWith(TX, FORM, FIELD);
  });

  it('answers with the rules’ field errors and writes nothing; unknown forms are not found', async () => {
    const { rt } = runtime('training_manager');
    const run = createDefineAction(rt);
    const removed = await run(actions.saveFieldActionDefinition())({
      ...fieldInput,
      fieldId: FIELD,
      condition: null,
      options: [{ value: 'basic', labelEn: 'Basic', labelAr: 'أساسي' }],
    });
    expect(!removed.ok && removed.error.fieldErrors).toEqual([
      { path: 'options', code: 'CONDITION_IN_USE' },
    ]);
    const system = await run(actions.deleteSectionActionDefinition())({
      formId: FORM,
      sectionId: SECTION,
    });
    expect(!system.ok && system.error.fieldErrors).toEqual([
      { path: 'section', code: 'SYSTEM_SECTION' },
    ]);
    db.getNeedsForm.mockResolvedValueOnce(uuidForm({ lockedAt: '2026-11-01T00:00:00.000Z' }));
    const locked = await run(actions.moveFieldActionDefinition())({
      formId: FORM,
      fieldId: FIELD,
      direction: 'up',
    });
    expect(!locked.ok && locked.error.fieldErrors).toEqual([
      { path: 'form', code: 'NEEDS_FORM_LOCKED' },
    ]);
    db.getNeedsForm.mockResolvedValueOnce(null);
    const unknown = await run(actions.deleteFieldActionDefinition())({
      formId: FORM,
      fieldId: FIELD,
    });
    expect(!unknown.ok && unknown.error.code).toBe('NOT_FOUND');
    db.getNeedsForm.mockResolvedValueOnce(null);
    const query = await createDefineQuery(rt)(actions.needsFormQueryDefinition())({ formId: FORM });
    expect(!query.ok && query.error.code).toBe('NOT_FOUND');
    expect(db.writeField).not.toHaveBeenCalled();
    expect(db.deleteSection).not.toHaveBeenCalled();
    expect(db.orderFields).not.toHaveBeenCalled();
  });

  it('turns a database refusal of the write into the screen’s error', async () => {
    const { rt } = runtime('training_manager');
    db.deleteField.mockRejectedValueOnce(new db.NeedsFormRefused('locked'));
    const result = await createDefineAction(rt)(actions.deleteFieldActionDefinition())({
      formId: FORM,
      fieldId: FIELD,
    });
    expect(!result.ok && result.error.fieldErrors).toEqual([
      { path: 'form', code: 'NEEDS_FORM_LOCKED' },
    ]);
  });
});
