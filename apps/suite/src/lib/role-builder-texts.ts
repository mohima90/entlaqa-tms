import 'server-only';
import {
  CUSTOM_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_GROUP_NAMES,
  ROLE_TEMPLATES,
  SYSTEM_ROLES,
  permissionMakesPrivileged,
  roleStartValues,
} from '@jadarat/platform-rbac';
import { getTranslations } from 'next-intl/server';
import type { BuilderGroup, BuilderStart } from './role-builder';

/** Text keys of the role builder (namespace `roleBuilder`). */
const KEYS = [
  'details',
  'startFrom',
  'startHint',
  'startPlaceholder',
  'startStandard',
  'startTemplate',
  'nameEn',
  'nameAr',
  'nameHint',
  'description',
  'descriptionHint',
  'permissions',
  'permissionsHint',
  'highRisk',
  'notHeld',
  'needsOrganization',
  'countLabel',
  'privilegedNotice',
  'dataScope',
  'scopeCleared',
  'audited',
  'save',
  'saving',
  'cancel',
  'delete',
  'deleteText',
  'deleteConfirm',
  'keep',
  'deleting',
  'inUseShort',
  'notFound',
  'conflict',
  'fieldErrors.required',
  'fieldErrors.name',
  'fieldErrors.nameTaken',
  'fieldErrors.description',
  'fieldErrors.permissions',
  'fieldErrors.dataScope',
] as const;
const SCOPES = ['own', 'team', 'departments', 'organization'] as const;

/** The builder's texts, translated on the server (`countLabel` keeps `{checked}` / `{total}`). */
export async function roleBuilderTexts(locale: 'ar' | 'en'): Promise<Record<string, string>> {
  const t = await getTranslations({ locale, namespace: 'roleBuilder' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const texts: Record<string, string> = Object.fromEntries(
    KEYS.filter((k) => k !== 'countLabel').map((k) => [k, t(k)]),
  );
  texts.countLabel = String(t.raw('countLabel'));
  for (const scope of SCOPES) {
    texts[`scopes.${scope}.label`] = t(`scopes.${scope}.label`);
    texts[`scopes.${scope}.hint`] = t(`scopes.${scope}.hint`);
  }
  texts.required = common('required');
  texts.optional = common('optional');
  texts.close = (await getTranslations({ locale, namespace: 'editRoles' }))('close');
  return texts;
}

/** The permissions accordion: the catalogue by module, with what the Organization Admin holds. */
export function roleBuilderGroups(locale: 'ar' | 'en', held: readonly string[]): BuilderGroup[] {
  const heldSet = new Set(held);
  return PERMISSION_GROUPS.map((group) => ({
    key: group,
    title: PERMISSION_GROUP_NAMES[group][locale],
    permissions: CUSTOM_ROLE_PERMISSIONS.filter((entry) => entry.group === group).map((entry) => ({
      code: entry.permission.code,
      label: entry.permission.label[locale],
      description: entry.permission.description[locale],
      highRisk: entry.permission.risk === 'high',
      makesPrivileged: permissionMakesPrivileged(entry.permission.code),
      organizationOnly: entry.use === 'organization_only',
      held: heldSet.has(entry.permission.code),
    })),
  })).filter((group) => group.permissions.length > 0);
}

/** «Start from»: a blank role, a copy of a standard role, or a template (code presets, not roles). */
export async function roleBuilderStarts(locale: 'ar' | 'en'): Promise<BuilderStart[]> {
  const t = await getTranslations({ locale, namespace: 'roleBuilder' });
  const blank = roleStartValues({ kind: 'blank' });
  const starts: BuilderStart[] = [
    {
      value: 'blank',
      label: t('startBlank'),
      group: 'blank',
      nameEn: null,
      nameAr: null,
      description: null,
      dataScope: blank.dataScope,
      permissions: blank.permissions,
    },
  ];
  for (const role of SYSTEM_ROLES) {
    // The Organization Admin's role defines the Organization Admin: not a starting point.
    if (role.code === 'tenant_admin') continue;
    const values = roleStartValues({ kind: 'standard', code: role.code });
    starts.push({
      value: `standard:${role.code}`,
      label: role.name[locale],
      group: 'standard',
      nameEn: null,
      nameAr: null,
      description: null,
      dataScope: values.dataScope,
      permissions: values.permissions,
    });
  }
  for (const template of ROLE_TEMPLATES) {
    const values = roleStartValues({ kind: 'template', key: template.key });
    starts.push({
      value: `template:${template.key}`,
      label: template.name[locale],
      group: 'template',
      nameEn: template.name.en,
      nameAr: template.name.ar,
      description: template.description[locale],
      dataScope: values.dataScope,
      permissions: values.permissions,
    });
  }
  return starts;
}
