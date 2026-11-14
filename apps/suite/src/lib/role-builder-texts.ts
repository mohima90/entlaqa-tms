import 'server-only';
import {
  CUSTOM_ROLE_PERMISSIONS,
  type CustomRolePermission,
  PERMISSION_GROUPS,
  PERMISSION_GROUP_NAMES,
  ROLE_TEMPLATES,
  STANDARD_ONLY_PERMISSIONS,
  SYSTEM_ROLES,
  permissionMakesPrivileged,
  roleStartValues,
} from '@jadarat/platform-rbac';
import { getTranslations } from 'next-intl/server';
import {
  type BuilderGroup,
  type BuilderStart,
  type BuilderValues,
  applyStart,
} from './role-builder';

/** Text keys of the role builder (namespace `roleBuilder`). */
const KEYS = [
  'details',
  'nameEn',
  'nameAr',
  'nameHint',
  'description',
  'descriptionHint',
  'permissions',
  'permissionsHint',
  'highRisk',
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
  'tabsLabel',
  'tabs.details',
  'tabs.permissions',
  'tabs.holders',
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
  // Raw: the form fills `{members}` / `{invitations}` from the refusal (C-M1).
  texts['fieldErrors.scopeUnitsInUse'] = String(t.raw('fieldErrors.scopeUnitsInUse'));
  for (const scope of SCOPES) {
    texts[`scopes.${scope}.label`] = t(`scopes.${scope}.label`);
    texts[`scopes.${scope}.hint`] = t(`scopes.${scope}.hint`);
  }
  texts.required = common('required');
  texts.optional = common('optional');
  texts.close = (await getTranslations({ locale, namespace: 'editRoles' }))('close');
  // Redesign package 3: the row button, the toasts that replace `?saved=1` / `?deleted=1`, the summary.
  const roles = await getTranslations({ locale, namespace: 'rolesPage' });
  const users = await getTranslations({ locale, namespace: 'users' });
  texts.titleEdit = t('titleEdit');
  texts.saved = roles('saved');
  texts.deleted = roles('deleted');
  texts.summary = users('statsLabel');
  texts.summarySees = t('summarySees');
  texts.searchPermissions = roles('searchPermissions');
  texts.undo = common('undo');
  texts.unsaved = common('unsavedChanges');
  texts.discardTitle = users('discardTitle');
  texts.discardBody = users('discardBody');
  texts.keepEditing = users('keepEditing');
  texts.discard = users('discard');
  texts.noMatches = users('noMatches');
  // «لا صلاحية عالية الخطورة» … per count (plural forms are formatted here, never on the client).
  const highRisk = CUSTOM_ROLE_PERMISSIONS.filter((e) => e.permission.risk === 'high').length;
  for (let count = 0; count <= highRisk; count += 1) {
    texts[`highRiskCount.${String(count)}`] = t('summaryHighRisk', { count });
  }
  return texts;
}

/**
 * The permissions accordion: the catalogue by module — every permission can be ticked (who can give what,
 * PO 17 Oct 2026: also the training permissions the Organization Admin does not hold).
 */
export function roleBuilderGroups(locale: 'ar' | 'en'): BuilderGroup[] {
  return groupsOf(locale, CUSTOM_ROLE_PERMISSIONS);
}

/**
 * A role's page (read-only): the builder's catalogue plus the permissions a custom role never holds but a
 * standard role does (the organization structure — STANDARD_ONLY_PERMISSIONS), so the HR Manager's page
 * still lists it.
 */
export function roleViewGroups(locale: 'ar' | 'en'): BuilderGroup[] {
  return groupsOf(locale, [
    ...CUSTOM_ROLE_PERMISSIONS,
    ...STANDARD_ONLY_PERMISSIONS.map((entry) => ({ ...entry, use: 'organization_only' as const })),
  ]);
}

function groupsOf(locale: 'ar' | 'en', entries: readonly CustomRolePermission[]): BuilderGroup[] {
  return PERMISSION_GROUPS.map((group) => ({
    key: group,
    title: PERMISSION_GROUP_NAMES[group][locale],
    permissions: entries
      .filter((entry) => entry.group === group)
      .map((entry) => ({
        code: entry.permission.code,
        label: entry.permission.label[locale],
        description: entry.permission.description[locale],
        highRisk: entry.permission.risk === 'high',
        makesPrivileged: permissionMakesPrivileged(entry.permission.code),
        organizationOnly: entry.use === 'organization_only',
      })),
  })).filter((group) => group.permissions.length > 0);
}

/** Text keys of «Create role» (the popup; namespace `roleBuilder`). */
const CREATE_KEYS = [
  'titleNew',
  'newIntro',
  'newNote',
  'startFrom',
  'startHint',
  'startStandard',
  'startTemplate',
  'nameEn',
  'nameAr',
  'cancel',
  'creating',
  'created',
  'fieldErrors.required',
  'fieldErrors.name',
  'fieldErrors.nameTaken',
] as const;

/** The texts of «Create role», translated on the server. */
export async function roleCreateTexts(locale: 'ar' | 'en'): Promise<Record<string, string>> {
  const t = await getTranslations({ locale, namespace: 'roleBuilder' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const texts: Record<string, string> = Object.fromEntries(CREATE_KEYS.map((k) => [k, t(k)]));
  texts.required = common('required');
  texts.optional = common('optional');
  texts.close = common('close');
  return texts;
}

const EMPTY_ROLE: BuilderValues = {
  nameEn: '',
  nameAr: '',
  description: '',
  dataScope: 'organization',
  permissions: [],
};

/**
 * «Start from» as «Create role» sends it: each choice with what it gives already worked out (`applyStart`:
 * its scope, and its permissions of the catalogue — an administrative one only with the whole organization),
 * so the popup needs no permission catalogue.
 */
export async function roleCreateStarts(locale: 'ar' | 'en'): Promise<BuilderStart[]> {
  const groups = roleBuilderGroups(locale);
  return (await roleBuilderStarts(locale)).map((start) => {
    const applied = applyStart(groups, EMPTY_ROLE, start);
    return { ...start, dataScope: applied.dataScope, permissions: applied.permissions };
  });
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
