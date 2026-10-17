import { ok } from '@jadarat/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => {
  const names = [
    'createNeedsFormAction',
    'duplicateNeedsFormAction',
    'renameNeedsFormAction',
    'setDefaultNeedsFormAction',
    'setNeedsFormActiveAction',
    'deleteNeedsFormAction',
    'saveSectionAction',
    'setSectionVisibleAction',
    'moveSectionAction',
    'deleteSectionAction',
    'saveFieldAction',
    'setFieldVisibleAction',
    'setFieldRequiredAction',
    'moveFieldAction',
    'deleteFieldAction',
  ] as const;
  return Object.fromEntries(
    names.map((name) => [name, vi.fn(() => Promise.resolve({ ok: true, value: name }))]),
  );
});
vi.mock('../actions/needs-forms', () => actions);

const { liveApi, previewApi } = await import('./needs-forms-api');
const { needsFormsTexts } = await import('./needs-forms-texts');

const FORM = '0c000000-0000-4000-8000-000000000001';
const SECTION = '0c000000-0000-4000-8000-0000000000a1';
const FIELD = '0c000000-0000-4000-8000-0000000000b1';
const names = { nameEn: 'Engineering', nameAr: 'الهندسة' };

describe('the needs forms API (T-M3-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const data = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    });
  });

  it('live: calls the server actions with the inputs they validate', async () => {
    await liveApi.create(names);
    await liveApi.duplicate(FORM, names);
    await liveApi.rename(FORM, 3, names);
    await liveApi.setDefault(FORM);
    await liveApi.setActive(FORM, false);
    await liveApi.remove(FORM);
    await liveApi.saveSection({
      formId: FORM,
      nameEn: 'S',
      nameAr: 'ق',
      descriptionEn: '',
      descriptionAr: '',
      repeatable: false,
      minEntries: 1,
      maxEntries: 1,
    });
    await liveApi.setSectionVisible(FORM, SECTION, true);
    await liveApi.moveSection(FORM, SECTION, 'up');
    await liveApi.deleteSection(FORM, SECTION);
    await liveApi.setFieldVisible(FORM, FIELD, false);
    await liveApi.setFieldRequired(FORM, FIELD, true);
    await liveApi.moveField(FORM, FIELD, 'down');
    await liveApi.deleteField(FORM, FIELD);
    expect(actions.renameNeedsFormAction).toHaveBeenCalledWith({
      formId: FORM,
      version: 3,
      ...names,
    });
    expect(actions.moveFieldAction).toHaveBeenCalledWith({
      formId: FORM,
      fieldId: FIELD,
      direction: 'down',
    });
    expect(actions.setSectionVisibleAction).toHaveBeenCalledWith({
      formId: FORM,
      sectionId: SECTION,
      visible: true,
    });
    const called = Object.values(actions).filter((fn) => fn.mock.calls.length > 0);
    expect(called).toHaveLength(14);
  });

  it('preview: the same calls on the tab’s copy, with the inputs checked', async () => {
    const api = previewApi();
    const empty = await api.create({ nameEn: ' ', nameAr: '' });
    expect(!empty.ok && empty.error.fieldErrors).toEqual([
      { path: 'nameEn', code: 'REQUIRED' },
      { path: 'nameAr', code: 'REQUIRED' },
    ]);
    const created = await api.create({ nameEn: ' Engineering ', nameAr: 'الهندسة' });
    if (!created.ok) throw new Error('create');
    expect(created.value.forms.map((f) => f.name.en)).toContain('Engineering');
    const formId = created.value.formId;
    const section = await api.saveSection({
      formId,
      nameEn: 'Context',
      nameAr: 'السياق',
      descriptionEn: '',
      descriptionAr: '',
      repeatable: false,
      minEntries: 1,
      maxEntries: 1,
    });
    const sectionId = section.ok ? (section.value.form.sections[1]?.id ?? '') : '';
    expect(sectionId).not.toBe('');
    const bad = await api.saveSection({
      formId,
      nameEn: '',
      nameAr: '',
      descriptionEn: '',
      descriptionAr: '',
      repeatable: false,
      minEntries: 1,
      maxEntries: 1,
    });
    expect(!bad.ok && bad.error.code).toBe('VALIDATION_FAILED');
    const field = await api.saveField({
      formId,
      sectionId,
      type: 'text',
      labelEn: 'Budget',
      labelAr: 'الميزانية',
      placeholderEn: '',
      placeholderAr: '',
      required: false,
      options: [],
      peopleMode: null,
      condition: null,
    });
    const fieldId = field.ok ? (field.value.form.sections[1]?.fields[0]?.id ?? '') : '';
    const badField = await api.saveField({
      formId,
      sectionId,
      type: 'text',
      labelEn: '',
      labelAr: '',
      placeholderEn: '',
      placeholderAr: '',
      required: false,
      options: [],
      peopleMode: null,
      condition: null,
    });
    expect(!badField.ok && badField.error.code).toBe('VALIDATION_FAILED');
    expect((await api.setFieldRequired(formId, fieldId, true)).ok).toBe(true);
    expect((await api.setFieldVisible(formId, fieldId, false)).ok).toBe(true);
    expect((await api.moveField(formId, fieldId, 'up')).ok).toBe(true);
    expect((await api.moveSection(formId, sectionId, 'up')).ok).toBe(true);
    expect((await api.setSectionVisible(formId, sectionId, false)).ok).toBe(true);
    expect((await api.deleteField(formId, fieldId)).ok).toBe(true);
    expect((await api.deleteSection(formId, sectionId)).ok).toBe(true);
    expect((await api.duplicate(formId, { nameEn: 'Copy', nameAr: 'نسخة' })).ok).toBe(true);
    expect((await api.rename(formId, 1, { nameEn: 'Renamed', nameAr: 'جديد' })).ok).toBe(true);
    expect((await api.setDefault(formId)).ok).toBe(true);
    expect((await api.setActive(formId, true)).ok).toBe(true);
    expect((await api.remove(formId)).ok).toBe(false); // the default form now
    expect(Object.values(actions).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('hands the client every needsForms text with the required / optional words', () => {
    const en = needsFormsTexts('en');
    expect(en.title).toBe('Needs forms');
    expect(en['types.people']).toBe('People');
    expect(en.markerRequired).toBe('(required)');
    expect(needsFormsTexts('ar').markerOptional).toBe('(اختياري)');
    expect(ok(1).ok).toBe(true);
  });
});
