import { getTranslations } from 'next-intl/server';
import type { RoleSelectTexts } from '../components/users/role-select';
import type { ScopeUnitTexts } from '../components/users/scope-unit-select';

/** Text keys of the edit-role form and its dialog (namespace `editRoles`). */
const EDIT_ROLE_KEYS = [
  'roleHint',
  'departmentsHint',
  'privilegedAdminOnly',
  'audited',
  'save',
  'saving',
  'saved',
  'noChanges',
  'cancel',
  'backToProfile',
  'roleRequired',
  'roleNotAllowed',
  'roleUnknown',
  'lastAdmin',
  'unit.unitRequired',
  'unit.unitNotAllowed',
  'unit.currentInactive',
  'editRole',
  'dialogTitle',
  'close',
  // The change-role panel (redesign package 3).
  'current',
] as const;

/** Keys whose text keeps a `{name}` placeholder (filled in on the client per member). */
const NAMED_KEYS = ['actionsFor', 'dialogDescription'] as const;

/** The edit-role form's texts, translated on the server (client forms get plain strings). */
export async function editRoleLabels(locale: 'ar' | 'en'): Promise<Record<string, string>> {
  const t = await getTranslations({ locale, namespace: 'editRoles' });
  const labels: Record<string, string> = Object.fromEntries(EDIT_ROLE_KEYS.map((k) => [k, t(k)]));
  for (const key of NAMED_KEYS) labels[key] = t(key, { name: '{name}' });
  // Raw: the panel fills `{name}` (and the Undo toast `{role}`) on the client.
  labels.titleFor = String(t.raw('titleFor'));
  labels.undone = String(t.raw('undone'));
  return labels;
}

/** The role dropdown's texts (shared by the invite form and the edit-role form). */
export async function roleSelectTexts(locale: 'ar' | 'en'): Promise<RoleSelectTexts> {
  const t = await getTranslations({ locale, namespace: 'editRoles.select' });
  return {
    label: t('label'),
    placeholder: t('placeholder'),
    standardGroup: t('standardGroup'),
    customGroup: t('customGroup'),
    privileged: t('privileged'),
    notAllowed: t('notAllowed'),
  };
}

/**
 * The unit picker's texts (department-limited custom roles, EP-ORG / T-M3-09; shared by the invite form and
 * the edit-role form).
 */
/**
 * Texts of the unit picker. `structureVisible` false (the giver lacks platform.org.read): the empty list is
 * explained as "you can't see the structure", not "no units yet" (C-12).
 */
export async function scopeUnitTexts(
  locale: 'ar' | 'en',
  structureVisible = true,
): Promise<ScopeUnitTexts> {
  const t = await getTranslations({ locale, namespace: 'editRoles.unit' });
  return {
    label: t('label'),
    hint: t('hint'),
    placeholder: t('placeholder'),
    inactive: t('inactive'),
    none: structureVisible ? t('none') : t('structureHidden'),
  };
}

const HEAD_UNIT_KEYS = [
  'label',
  'hint',
  'keep',
  'placeholder',
  'inactive',
  'none',
  'listSeparator',
  'takenBy',
  'takenUnnamed',
  'required',
  'taken',
  'notActive',
  'notAllowed',
  'replaceTitle',
  'replaceBody',
  'replaceBodyUnnamed',
  'replaceConfirm',
  'clearTitle',
  'clearBody',
  'clearConfirm',
  'cancel',
  'savedHead',
  'savedCleared',
  'savedNoUnit',
  'invitedNoUnit',
] as const;

/**
 * «Head of which department?» under the Department Head role (WP-FIX-03; shared by the invite form and
 * the edit-role form). Raw texts: the forms fill `{name}`, `{unit}`, `{units}` and `{head}`.
 */
export async function headUnitTexts(locale: 'ar' | 'en'): Promise<Record<string, string>> {
  const t = await getTranslations({ locale, namespace: 'editRoles.head' });
  return Object.fromEntries(HEAD_UNIT_KEYS.map((key) => [key, String(t.raw(key))]));
}
