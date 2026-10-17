import { getTranslations } from 'next-intl/server';
import type { RoleSelectTexts } from '../components/users/role-select';

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
  'editRole',
  'dialogTitle',
  'close',
] as const;

/** Keys whose text keeps a `{name}` placeholder (filled in on the client per member). */
const NAMED_KEYS = ['actionsFor', 'dialogDescription'] as const;

/** The edit-role form's texts, translated on the server (client forms get plain strings). */
export async function editRoleLabels(locale: 'ar' | 'en'): Promise<Record<string, string>> {
  const t = await getTranslations({ locale, namespace: 'editRoles' });
  const labels: Record<string, string> = Object.fromEntries(EDIT_ROLE_KEYS.map((k) => [k, t(k)]));
  for (const key of NAMED_KEYS) labels[key] = t(key, { name: '{name}' });
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
