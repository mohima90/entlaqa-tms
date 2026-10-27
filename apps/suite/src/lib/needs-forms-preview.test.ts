import { SaveFieldInput } from '@jadarat/tms/needs-forms';
import { describe, expect, it } from 'vitest';
import {
  NeedsFormsPreview,
  PREVIEW_STORAGE_KEY,
  type PreviewStorage,
  previewForm,
  previewSummaries,
} from './needs-forms-preview';

function memory(): PreviewStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const names = { nameEn: 'Engineering', nameAr: 'الهندسة' };

describe('the needs forms preview copy (no database, T-M3-10)', () => {
  it('starts from the default form and keeps changes in the tab', () => {
    const storage = memory();
    const store = new NeedsFormsPreview(storage);
    const [first] = store.list();
    expect(first).toMatchObject({ isDefault: true, sectionCount: 1, fieldCount: 9 });
    const snapshot = storage.data.get(PREVIEW_STORAGE_KEY) ?? '';
    expect(previewSummaries(snapshot)).toEqual([first]);
    expect(previewForm(snapshot, first?.id ?? '')?.sections[0]?.fields).toHaveLength(9);
    expect(previewForm('not json', 'x')).toBeNull();
    expect(previewSummaries('not json')).toEqual([]);

    const created = store.create(names);
    expect(created.ok && created.value.forms.map((f) => f.name.en)).toEqual([
      'Default needs form',
      'Engineering',
    ]);
    // The same name again is refused (English or Arabic, any case).
    const again = store.create({ nameEn: 'ENGINEERING', nameAr: 'آخر' });
    expect(!again.ok && again.error.fieldErrors).toEqual([{ path: 'nameEn', code: 'NAME_TAKEN' }]);
    const arabic = store.create({ nameEn: 'Other', nameAr: 'الهندسة' });
    expect(!arabic.ok && arabic.error.fieldErrors).toEqual([
      { path: 'nameAr', code: 'NAME_TAKEN' },
    ]);
  });

  it('builds, duplicates (conditions re-pointed), renames, sets the default, switches off and deletes', () => {
    const store = new NeedsFormsPreview(memory());
    store.list();
    const created = store.create(names);
    if (!created.ok) throw new Error('create');
    const formId = created.value.formId;
    const sectionId = store.get(formId)?.sections[0]?.id ?? '';
    const field = (over: Record<string, unknown>) =>
      SaveFieldInput.parse({
        formId,
        sectionId,
        labelEn: 'Level',
        labelAr: 'المستوى',
        placeholderEn: '',
        placeholderAr: '',
        required: false,
        options: [],
        peopleMode: null,
        condition: null,
        type: 'text',
        ...over,
      });
    const withLevel = store.change(formId, {
      kind: 'saveField',
      input: field({ type: 'radio', options: [{ labelEn: 'Advanced', labelAr: 'متقدم' }] }),
    });
    const levelId = withLevel.ok ? (withLevel.value.form.sections[0]?.fields[2]?.id ?? '') : '';
    expect(
      store.change(formId, {
        kind: 'saveField',
        input: field({
          labelEn: 'Details',
          labelAr: 'تفاصيل',
          condition: { fieldId: levelId, value: 'advanced' },
        }),
      }).ok,
    ).toBe(true);
    expect(store.change('nope', { kind: 'deleteField', fieldId: levelId })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });

    const copy = store.duplicate(formId, { nameEn: 'Copy', nameAr: 'نسخة' });
    if (!copy.ok) throw new Error('duplicate');
    const copied = store.get(copy.value.formId);
    const [, , copiedLevel, copiedDetails] = copied?.sections[0]?.fields ?? [];
    expect(copiedLevel?.id).not.toBe(levelId);
    expect(copiedDetails?.condition).toEqual({ fieldId: copiedLevel?.id, value: 'advanced' });
    expect(store.duplicate('nope', { nameEn: 'X', nameAr: 'س' })).toMatchObject({ ok: false });

    expect(store.rename(formId, 1, { nameEn: 'Engineering 2027', nameAr: 'الهندسة 2027' }).ok).toBe(
      true,
    );
    expect(store.rename(formId, 1, { nameEn: 'Again', nameAr: 'مجددًا' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT_VERSION' },
    });
    expect(store.rename('nope', 1, names)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });

    const defaulted = store.setDefault(formId);
    expect(defaulted.ok && defaulted.value.forms[0]).toMatchObject({ id: formId, isDefault: true });
    expect(store.setActive(formId, false)).toMatchObject({
      ok: false,
      error: { fieldErrors: [{ code: 'DEFAULT_FORM' }] },
    });
    expect(store.remove(formId)).toMatchObject({
      ok: false,
      error: { fieldErrors: [{ code: 'DEFAULT_FORM' }] },
    });
    expect(store.setActive(copy.value.formId, false).ok).toBe(true);
    expect(store.get(copy.value.formId)?.isActive).toBe(false);
    expect(store.remove(copy.value.formId).ok).toBe(true);
    expect(store.get(copy.value.formId)).toBeNull();
    for (const result of [
      store.setDefault('nope'),
      store.setActive('nope', true),
      store.remove('nope'),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    }
  });

  it('works without storage (blocked) and with damaged storage', () => {
    expect(new NeedsFormsPreview(null).list()).toHaveLength(1);
    const broken: PreviewStorage = {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(new NeedsFormsPreview(broken).list()[0]?.isDefault).toBe(true);
  });
});
