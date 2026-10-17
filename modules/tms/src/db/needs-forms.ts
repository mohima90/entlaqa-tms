import 'server-only';
import type { UserTx } from '@jadarat/platform-db';
import { sql } from 'drizzle-orm';
import type {
  FieldOption,
  FieldType,
  NeedsFormDefinition,
  NeedsFormField,
  NeedsFormSection,
  NeedsFormSummary,
  PeopleMode,
  SystemKey,
} from '../needs-forms/model';

/**
 * The TMS module's own data access for needs forms (T-M3-10; migration 20261020180200). The calling actions
 * authorize (`tms.needs_form.read` to read, `tms.needs_form.manage` to change) and audit; the database
 * guards have the final word (designer only, system fields, lock, default form, conditions). Row-level
 * security keeps every read and write in the caller's organization.
 */

/** Why the database refused a change. */
export type NeedsFormRefusal =
  | 'not_allowed'
  | 'locked'
  | 'system'
  | 'default'
  | 'condition'
  | 'limit'
  | 'name_en_taken'
  | 'name_ar_taken'
  | 'version_conflict'
  | 'not_found';

export class NeedsFormRefused extends Error {
  override readonly name = 'NeedsFormRefused';
  constructor(readonly refusal: NeedsFormRefusal) {
    super(`needs form change refused: ${refusal}`);
  }
}

function pgError(error: unknown): { code?: string; constraint?: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      return {
        code: e.code,
        ...(typeof e.constraint_name === 'string' ? { constraint: e.constraint_name } : {}),
      };
    }
    current = e.cause;
  }
  return null;
}

/** Maps a database refusal to a reason; rethrows anything else (an unexpected error stays internal). */
export function needsFormRefusalOf(error: unknown): NeedsFormRefusal {
  if (error instanceof NeedsFormRefused) return error.refusal;
  const pg = pgError(error);
  switch (pg?.code) {
    case '42501':
      return 'not_allowed';
    case 'JN001':
      return 'locked';
    case 'JN002':
      return 'system';
    case 'JN003':
      return 'default';
    case 'JN004':
      return 'condition';
    case 'JN005':
      return 'limit';
    case '23505':
      if (pg.constraint === 'needs_forms_tenant_name_en_uq') return 'name_en_taken';
      if (pg.constraint === 'needs_forms_tenant_name_ar_uq') return 'name_ar_taken';
      if (pg.constraint === 'needs_forms_tenant_default_uq') return 'default';
      break;
    default:
      break;
  }
  throw error;
}

interface RawForm extends Record<string, unknown> {
  id: string;
  name_en: string;
  name_ar: string;
  is_default: boolean;
  is_active: boolean;
  locked_at: string | Date | null;
  version: number;
  section_count: number | string;
  field_count: number | string;
}

interface RawSection extends Record<string, unknown> {
  id: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  is_repeatable: boolean;
  min_entries: number;
  max_entries: number;
  is_visible: boolean;
}

interface RawField extends Record<string, unknown> {
  id: string;
  section_id: string;
  system_key: SystemKey | null;
  field_type: FieldType;
  label_en: string;
  label_ar: string;
  placeholder_en: string | null;
  placeholder_ar: string | null;
  is_required: boolean;
  is_visible: boolean;
  options: { value: string; label_en: string; label_ar: string }[] | null;
  people_mode: PeopleMode | null;
  condition_field_id: string | null;
  condition_value: string | null;
}

const iso = (value: string | Date | null): string | null =>
  value === null ? null : new Date(value).toISOString();

function toSummary(r: RawForm): NeedsFormSummary {
  return {
    id: r.id,
    name: { en: r.name_en, ar: r.name_ar },
    isDefault: r.is_default,
    isActive: r.is_active,
    lockedAt: iso(r.locked_at),
    version: r.version,
    sectionCount: Number(r.section_count),
    fieldCount: Number(r.field_count),
  };
}

function toField(r: RawField): NeedsFormField {
  return {
    id: r.id,
    systemKey: r.system_key,
    type: r.field_type,
    label: { en: r.label_en, ar: r.label_ar },
    placeholder: {
      ...(r.placeholder_en ? { en: r.placeholder_en } : {}),
      ...(r.placeholder_ar ? { ar: r.placeholder_ar } : {}),
    },
    required: r.is_required,
    visible: r.is_visible,
    options: (r.options ?? []).map((o) => ({
      value: o.value,
      label: { en: o.label_en, ar: o.label_ar },
    })),
    peopleMode: r.people_mode,
    // A condition whose field was deleted keeps its value only (the database clears the field id).
    condition:
      r.condition_field_id && r.condition_value
        ? { fieldId: r.condition_field_id, value: r.condition_value }
        : null,
  };
}

const SUMMARY = sql`
  select f.id, f.name_en, f.name_ar, f.is_default, f.is_active, f.locked_at, f.version,
         (select count(*) from tms.needs_form_sections s where s.tenant_id = f.tenant_id and s.form_id = f.id) as section_count,
         (select count(*) from tms.needs_form_fields x where x.tenant_id = f.tenant_id and x.form_id = f.id) as field_count
  from tms.needs_forms f`;

/** The organization's forms: the default first, then by English name. */
export async function listNeedsForms(tx: UserTx): Promise<readonly NeedsFormSummary[]> {
  const rows = await tx.execute<RawForm>(
    sql`${SUMMARY} order by f.is_default desc, lower(f.name_en), f.id`,
  );
  return rows.map(toSummary);
}

/** One form with its sections and fields in order, or null (unknown or another organization's). */
export async function getNeedsForm(
  tx: UserTx,
  formId: string,
  options: { readonly forUpdate?: boolean } = {},
): Promise<NeedsFormDefinition | null> {
  if (options.forUpdate) {
    // Serialises the builder's changes of one form (and the cycle launch's lock) before reading it.
    await tx.execute(sql`select 1 from tms.needs_forms where id = ${formId}::uuid for update`);
  }
  const [form] = await tx.execute<RawForm>(sql`${SUMMARY} where f.id = ${formId}::uuid`);
  if (!form) return null;
  const sections = await tx.execute<RawSection>(sql`
    select id, name_en, name_ar, description_en, description_ar, is_repeatable, min_entries, max_entries, is_visible
    from tms.needs_form_sections where form_id = ${formId}::uuid order by sort_order, created_at, id`);
  const fields = await tx.execute<RawField>(sql`
    select id, section_id, system_key, field_type, label_en, label_ar, placeholder_en, placeholder_ar, is_required,
           is_visible, options, people_mode, condition_field_id, condition_value
    from tms.needs_form_fields where form_id = ${formId}::uuid order by sort_order, created_at, id`);
  const toSection = (s: RawSection): NeedsFormSection => ({
    id: s.id,
    name: { en: s.name_en, ar: s.name_ar },
    description: {
      ...(s.description_en ? { en: s.description_en } : {}),
      ...(s.description_ar ? { ar: s.description_ar } : {}),
    },
    repeatable: s.is_repeatable,
    minEntries: s.min_entries,
    maxEntries: s.max_entries,
    visible: s.is_visible,
    fields: fields.filter((f) => f.section_id === s.id).map(toField),
  });
  return { ...toSummary(form), sections: sections.map(toSection) };
}

export interface FormNames {
  readonly nameEn: string;
  readonly nameAr: string;
}

/** A new, blank form (the «Training needs» section with the two system fields); its id. */
export async function createNeedsForm(tx: UserTx, names: FormNames): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(sql`
    select private.seed_needs_form(private.current_tenant_id(), ${names.nameEn}, ${names.nameAr}, false, false) as id`);
  if (!row?.id) throw new Error('createNeedsForm: no form returned');
  return row.id;
}

/** Copies a form under new names; null when the form is unknown. */
export async function duplicateNeedsForm(
  tx: UserTx,
  formId: string,
  names: FormNames,
): Promise<string | null> {
  const [row] = await tx.execute<{ id: string | null }>(sql`
    select private.duplicate_needs_form(${formId}::uuid, ${names.nameEn}, ${names.nameAr}) as id`);
  return row?.id ?? null;
}

/** Renames a form still at `version` (allowed when locked: names are labels). */
export async function renameNeedsForm(
  tx: UserTx,
  formId: string,
  version: number,
  names: FormNames,
): Promise<void> {
  const rows = await tx.execute<{ version: number }>(sql`
    select version from tms.needs_forms where id = ${formId}::uuid for update`);
  const current = rows[0];
  if (!current) throw new NeedsFormRefused('not_found');
  if (current.version !== version) throw new NeedsFormRefused('version_conflict');
  await tx.execute(sql`update tms.needs_forms set name_en = ${names.nameEn}, name_ar = ${names.nameAr}
    where id = ${formId}::uuid`);
}

/** Makes the form the default (and active); the previous default stops being one in the same transaction. */
export async function setDefaultNeedsForm(tx: UserTx, formId: string): Promise<void> {
  await tx.execute(
    sql`update tms.needs_forms set is_default = false where is_default and id <> ${formId}::uuid`,
  );
  const rows = await tx.execute(sql`update tms.needs_forms set is_default = true, is_active = true
    where id = ${formId}::uuid returning id`);
  if (rows.length === 0) throw new NeedsFormRefused('not_found');
}

export async function setNeedsFormActive(
  tx: UserTx,
  formId: string,
  active: boolean,
): Promise<void> {
  const rows = await tx.execute(sql`update tms.needs_forms set is_active = ${active}
    where id = ${formId}::uuid returning id`);
  if (rows.length === 0) throw new NeedsFormRefused('not_found');
}

export async function deleteNeedsForm(tx: UserTx, formId: string): Promise<void> {
  const rows = await tx.execute(
    sql`delete from tms.needs_forms where id = ${formId}::uuid returning id`,
  );
  if (rows.length === 0) throw new NeedsFormRefused('not_found');
}

/** Writes a section as the builder's rules produced it (new: appended last). */
export async function writeSection(
  tx: UserTx,
  formId: string,
  section: NeedsFormSection,
  isNew: boolean,
): Promise<void> {
  if (isNew) {
    await tx.execute(sql`
      insert into tms.needs_form_sections (id, form_id, name_en, name_ar, description_en, description_ar,
                                           is_repeatable, min_entries, max_entries, is_visible, sort_order)
      values (${section.id}::uuid, ${formId}::uuid, ${section.name.en}, ${section.name.ar},
              ${section.description.en ?? null}, ${section.description.ar ?? null}, ${section.repeatable},
              ${section.minEntries}, ${section.maxEntries}, ${section.visible},
              (select coalesce(max(sort_order), 0) + 1 from tms.needs_form_sections where form_id = ${formId}::uuid))`);
    return;
  }
  await tx.execute(sql`
    update tms.needs_form_sections
    set name_en = ${section.name.en}, name_ar = ${section.name.ar}, description_en = ${section.description.en ?? null},
        description_ar = ${section.description.ar ?? null}, is_repeatable = ${section.repeatable},
        min_entries = ${section.minEntries}, max_entries = ${section.maxEntries}, is_visible = ${section.visible}
    where id = ${section.id}::uuid and form_id = ${formId}::uuid`);
}

export async function deleteSection(tx: UserTx, formId: string, sectionId: string): Promise<void> {
  await tx.execute(
    sql`delete from tms.needs_form_sections where id = ${sectionId}::uuid and form_id = ${formId}::uuid`,
  );
}

/** Saves the order of the form's sections (1, 2, …) as given. */
export async function orderSections(
  tx: UserTx,
  formId: string,
  ids: readonly string[],
): Promise<void> {
  for (const [index, id] of ids.entries()) {
    await tx.execute(sql`update tms.needs_form_sections set sort_order = ${index + 1}
      where id = ${id}::uuid and form_id = ${formId}::uuid and sort_order <> ${index + 1}`);
  }
}

/** Saves the order of a section's fields (1, 2, …) as given. */
export async function orderFields(
  tx: UserTx,
  sectionId: string,
  ids: readonly string[],
): Promise<void> {
  for (const [index, id] of ids.entries()) {
    await tx.execute(sql`update tms.needs_form_fields set sort_order = ${index + 1}
      where id = ${id}::uuid and section_id = ${sectionId}::uuid and sort_order <> ${index + 1}`);
  }
}

const optionsJson = (options: readonly FieldOption[]): string | null =>
  options.length === 0
    ? null
    : JSON.stringify(
        options.map((o) => ({ value: o.value, label_en: o.label.en, label_ar: o.label.ar })),
      );

/** Writes a field as the builder's rules produced it (new: appended last in its section). */
export async function writeField(
  tx: UserTx,
  formId: string,
  sectionId: string,
  field: NeedsFormField,
  isNew: boolean,
): Promise<void> {
  const options = optionsJson(field.options);
  if (isNew) {
    await tx.execute(sql`
      insert into tms.needs_form_fields (id, form_id, section_id, field_type, label_en, label_ar, placeholder_en,
                                         placeholder_ar, is_required, is_visible, options, people_mode,
                                         condition_field_id, condition_value, sort_order)
      values (${field.id}::uuid, ${formId}::uuid, ${sectionId}::uuid, ${field.type}, ${field.label.en}, ${field.label.ar},
              ${field.placeholder.en ?? null}, ${field.placeholder.ar ?? null}, ${field.required}, ${field.visible},
              ${options}::jsonb, ${field.peopleMode}, ${field.condition?.fieldId ?? null}::uuid,
              ${field.condition?.value ?? null},
              (select coalesce(max(sort_order), 0) + 1 from tms.needs_form_fields where section_id = ${sectionId}::uuid))`);
    return;
  }
  await tx.execute(sql`
    update tms.needs_form_fields
    set field_type = ${field.type}, label_en = ${field.label.en}, label_ar = ${field.label.ar},
        placeholder_en = ${field.placeholder.en ?? null}, placeholder_ar = ${field.placeholder.ar ?? null},
        is_required = ${field.required}, is_visible = ${field.visible}, options = ${options}::jsonb,
        people_mode = ${field.peopleMode}, condition_field_id = ${field.condition?.fieldId ?? null}::uuid,
        condition_value = ${field.condition?.value ?? null}
    where id = ${field.id}::uuid and form_id = ${formId}::uuid`);
}

export async function deleteField(tx: UserTx, formId: string, fieldId: string): Promise<void> {
  await tx.execute(
    sql`delete from tms.needs_form_fields where id = ${fieldId}::uuid and form_id = ${formId}::uuid`,
  );
}
