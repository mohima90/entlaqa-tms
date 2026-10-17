import 'server-only';
import { type AppError, type Result, appError, err, ok } from '@jadarat/platform-core';
import type { UserTx } from '@jadarat/platform-db';
import type { ActionDefinition, AuditRecord, QueryDefinition } from '@jadarat/platform-rbac';
import { z } from 'zod';
import * as db from '../db/needs-forms';
import { tmsPermissions } from '../permissions';
import {
  CreateNeedsFormInput,
  DuplicateNeedsFormInput,
  FieldRefInput,
  MoveFieldInput,
  MoveSectionInput,
  NeedsFormRefInput,
  RenameNeedsFormInput,
  SaveFieldInput,
  SaveSectionInput,
  SectionRefInput,
  SetFieldRequiredInput,
  SetFieldVisibleInput,
  SetNeedsFormActiveInput,
  SetSectionVisibleInput,
} from './inputs';
import type { NeedsFormDefinition, NeedsFormSummary } from './model';
import { type FormChange, applyFormChange, deleteRefusal } from './rules';

/**
 * The needs forms library and builder (T-M3-10; FR-PLN-02/03): definitions of the queries and server
 * actions, bound in the app (apps/suite actions/needs-forms.ts, lib/needs-forms-queries.ts). Reading needs
 * `tms.needs_form.read` (L&D Manager, Training Coordinator), changing `tms.needs_form.manage` (L&D Manager),
 * both organization-wide. Every change is checked by the builder's rules first (field errors for the
 * screen), then by the database guards; each is audited with ids and the kind of change (no answers, no
 * personal data).
 */
const EmptyInput = z.strictObject({});
const read = tmsPermissions['tms.needs_form.read'];
const manage = tmsPermissions['tms.needs_form.manage'];

export interface NeedsFormsLibraryView {
  readonly forms: readonly NeedsFormSummary[];
  readonly canManage: boolean;
}

export interface NeedsFormView {
  readonly form: NeedsFormDefinition;
  readonly canManage: boolean;
}

export interface LibraryChanged {
  readonly formId: string;
  readonly forms: readonly NeedsFormSummary[];
}

export interface FormChanged {
  readonly form: NeedsFormDefinition;
}

const newId = (): string => globalThis.crypto.randomUUID();

const validation = (path: string, code: string) =>
  appError('VALIDATION_FAILED', { fieldErrors: [{ path, code }] });

/** A database refusal as the error the screen shows. */
export function refusalError(refusal: db.NeedsFormRefusal): AppError {
  switch (refusal) {
    case 'not_allowed':
      return appError('FORBIDDEN');
    case 'not_found':
      return appError('NOT_FOUND');
    case 'version_conflict':
      return appError('CONFLICT_VERSION');
    case 'locked':
      return validation('form', 'NEEDS_FORM_LOCKED');
    case 'system':
      return validation('field', 'SYSTEM_FIELD');
    case 'default':
      return validation('form', 'DEFAULT_FORM');
    case 'condition':
      return validation('condition', 'CONDITION_FIELD');
    case 'limit':
      return validation('form', 'TOO_MANY');
    case 'name_en_taken':
      return validation('nameEn', 'NAME_TAKEN');
    case 'name_ar_taken':
      return validation('nameAr', 'NAME_TAKEN');
  }
}

/** Runs a database write; a refusal becomes the screen's error, anything else stays internal (thrown). */
async function attempt<T>(work: () => Promise<T>): Promise<Result<T, AppError>> {
  try {
    return ok(await work());
  } catch (error) {
    return err(refusalError(db.needsFormRefusalOf(error)));
  }
}

const audit =
  (action: string, data: (input: never) => Record<string, unknown> = () => ({})) =>
  (input: unknown, output: { readonly formId?: string; readonly form?: { readonly id: string } }) =>
    ({
      action: `tms.needs_form.${action}`,
      entityType: 'needs_form',
      entityId: output.formId ?? output.form?.id ?? '',
      data: data(input as never),
    }) satisfies AuditRecord;

// ---------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------
export function needsFormsLibraryQueryDefinition(): QueryDefinition<
  typeof EmptyInput,
  NeedsFormsLibraryView,
  UserTx
> {
  return {
    permission: read,
    input: EmptyInput,
    handler: async ({ ctx }) =>
      ok({ forms: await db.listNeedsForms(ctx.tx), canManage: ctx.can(manage, 'tenant') }),
  };
}

export function needsFormQueryDefinition(): QueryDefinition<
  typeof NeedsFormRefInput,
  NeedsFormView,
  UserTx
> {
  return {
    permission: read,
    input: NeedsFormRefInput,
    handler: async ({ ctx, input }) => {
      const form = await db.getNeedsForm(ctx.tx, input.formId);
      return form ? ok({ form, canManage: ctx.can(manage, 'tenant') }) : err(appError('NOT_FOUND'));
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------------------------------
async function libraryChanged(tx: UserTx, formId: string): Promise<LibraryChanged> {
  return { formId, forms: await db.listNeedsForms(tx) };
}

export function createNeedsFormActionDefinition(): ActionDefinition<
  typeof CreateNeedsFormInput,
  LibraryChanged,
  UserTx
> {
  return {
    permission: manage,
    input: CreateNeedsFormInput,
    handler: async ({ ctx, input }) => {
      const created = await attempt(() => db.createNeedsForm(ctx.tx, input));
      return created.ok ? ok(await libraryChanged(ctx.tx, created.value)) : created;
    },
    audit: audit('created'),
  };
}

export function duplicateNeedsFormActionDefinition(): ActionDefinition<
  typeof DuplicateNeedsFormInput,
  LibraryChanged,
  UserTx
> {
  return {
    permission: manage,
    input: DuplicateNeedsFormInput,
    handler: async ({ ctx, input }) => {
      const copied = await attempt(() => db.duplicateNeedsForm(ctx.tx, input.formId, input));
      if (!copied.ok) return copied;
      if (copied.value === null) return err(appError('NOT_FOUND'));
      return ok(await libraryChanged(ctx.tx, copied.value));
    },
    audit: audit('duplicated', (input: z.output<typeof DuplicateNeedsFormInput>) => ({
      sourceFormId: input.formId,
    })),
  };
}

export function renameNeedsFormActionDefinition(): ActionDefinition<
  typeof RenameNeedsFormInput,
  LibraryChanged,
  UserTx
> {
  return {
    permission: manage,
    input: RenameNeedsFormInput,
    handler: async ({ ctx, input }) => {
      const renamed = await attempt(() =>
        db.renameNeedsForm(ctx.tx, input.formId, input.version, input),
      );
      return renamed.ok ? ok(await libraryChanged(ctx.tx, input.formId)) : renamed;
    },
    audit: audit('renamed'),
  };
}

export function setDefaultNeedsFormActionDefinition(): ActionDefinition<
  typeof NeedsFormRefInput,
  LibraryChanged,
  UserTx
> {
  return {
    permission: manage,
    input: NeedsFormRefInput,
    handler: async ({ ctx, input }) => {
      const done = await attempt(() => db.setDefaultNeedsForm(ctx.tx, input.formId));
      return done.ok ? ok(await libraryChanged(ctx.tx, input.formId)) : done;
    },
    audit: audit('default_set'),
  };
}

export function setNeedsFormActiveActionDefinition(): ActionDefinition<
  typeof SetNeedsFormActiveInput,
  LibraryChanged,
  UserTx
> {
  return {
    permission: manage,
    input: SetNeedsFormActiveInput,
    handler: async ({ ctx, input }) => {
      const forms = await db.listNeedsForms(ctx.tx);
      const form = forms.find((f) => f.id === input.formId);
      if (!form) return err(appError('NOT_FOUND'));
      if (form.isDefault && !input.active) return err(validation('form', 'DEFAULT_FORM'));
      const done = await attempt(() => db.setNeedsFormActive(ctx.tx, input.formId, input.active));
      return done.ok ? ok(await libraryChanged(ctx.tx, input.formId)) : done;
    },
    audit: audit('activation_changed', (input: z.output<typeof SetNeedsFormActiveInput>) => ({
      active: input.active,
    })),
  };
}

export function deleteNeedsFormActionDefinition(): ActionDefinition<
  typeof NeedsFormRefInput,
  LibraryChanged,
  UserTx
> {
  return {
    permission: manage,
    input: NeedsFormRefInput,
    handler: async ({ ctx, input }) => {
      const form = (await db.listNeedsForms(ctx.tx)).find((f) => f.id === input.formId);
      if (!form) return err(appError('NOT_FOUND'));
      const refusal = deleteRefusal(form);
      if (refusal) return err(validation('form', refusal));
      const done = await attempt(() => db.deleteNeedsForm(ctx.tx, input.formId));
      return done.ok ? ok(await libraryChanged(ctx.tx, input.formId)) : done;
    },
    audit: audit('deleted'),
  };
}

// ---------------------------------------------------------------------------------------------------
// The builder: one change of one form, checked by the rules, written, read back.
// ---------------------------------------------------------------------------------------------------
async function changeForm(
  tx: UserTx,
  formId: string,
  change: FormChange,
  write: (before: NeedsFormDefinition, after: NeedsFormDefinition) => Promise<void>,
): Promise<Result<FormChanged, AppError>> {
  const before = await db.getNeedsForm(tx, formId, { forUpdate: true });
  if (!before) return err(appError('NOT_FOUND'));
  const after = applyFormChange(before, change, newId);
  if (!after.ok) return after;
  const written = await attempt(() => write(before, after.value));
  if (!written.ok) return written;
  const form = await db.getNeedsForm(tx, formId);
  return form ? ok({ form }) : err(appError('NOT_FOUND'));
}

const sectionOf = (form: NeedsFormDefinition, sectionId: string) =>
  form.sections.find((s) => s.id === sectionId);

/** The section that is in `after` but not in `before` (a new one), else the one with `id`. */
function changedSection(
  before: NeedsFormDefinition,
  after: NeedsFormDefinition,
  id: string | undefined,
) {
  const section = id
    ? sectionOf(after, id)
    : after.sections.find((s) => !before.sections.some((b) => b.id === s.id));
  if (!section) throw new db.NeedsFormRefused('not_found');
  return { section, isNew: id === undefined };
}

export function saveSectionActionDefinition(): ActionDefinition<
  typeof SaveSectionInput,
  FormChanged,
  UserTx
> {
  return {
    permission: manage,
    input: SaveSectionInput,
    handler: ({ ctx, input }) =>
      changeForm(ctx.tx, input.formId, { kind: 'saveSection', input }, async (before, after) => {
        const { section, isNew } = changedSection(before, after, input.sectionId);
        await db.writeSection(ctx.tx, input.formId, section, isNew);
      }),
    audit: audit('section_saved', (input: z.output<typeof SaveSectionInput>) => ({
      sectionId: input.sectionId ?? null,
    })),
  };
}

export function setSectionVisibleActionDefinition(): ActionDefinition<
  typeof SetSectionVisibleInput,
  FormChanged,
  UserTx
> {
  return {
    permission: manage,
    input: SetSectionVisibleInput,
    handler: ({ ctx, input }) =>
      changeForm(ctx.tx, input.formId, { kind: 'setSectionVisible', ...input }, async (_b, after) => {
        const section = sectionOf(after, input.sectionId);
        if (!section) throw new db.NeedsFormRefused('not_found');
        await db.writeSection(ctx.tx, input.formId, section, false);
      }),
    audit: audit('section_visibility_changed', (input: z.output<typeof SetSectionVisibleInput>) => ({
      sectionId: input.sectionId,
      visible: input.visible,
    })),
  };
}

export function moveSectionActionDefinition(): ActionDefinition<
  typeof MoveSectionInput,
  FormChanged,
  UserTx
> {
  return {
    permission: manage,
    input: MoveSectionInput,
    handler: ({ ctx, input }) =>
      changeForm(ctx.tx, input.formId, { kind: 'moveSection', ...input }, (_b, after) =>
        db.orderSections(
          ctx.tx,
          input.formId,
          after.sections.map((s) => s.id),
        ),
      ),
    audit: audit('section_moved', (input: z.output<typeof MoveSectionInput>) => ({
      sectionId: input.sectionId,
      direction: input.direction,
    })),
  };
}

export function deleteSectionActionDefinition(): ActionDefinition<
  typeof SectionRefInput,
  FormChanged,
  UserTx
> {
  return {
    permission: manage,
    input: SectionRefInput,
    handler: ({ ctx, input }) =>
      changeForm(ctx.tx, input.formId, { kind: 'deleteSection', ...input }, () =>
        db.deleteSection(ctx.tx, input.formId, input.sectionId),
      ),
    audit: audit('section_deleted', (input: z.output<typeof SectionRefInput>) => ({
      sectionId: input.sectionId,
    })),
  };
}

function fieldOf(form: NeedsFormDefinition, fieldId: string) {
  for (const section of form.sections) {
    const field = section.fields.find((f) => f.id === fieldId);
    if (field) return { section, field };
  }
  throw new db.NeedsFormRefused('not_found');
}

export function saveFieldActionDefinition(): ActionDefinition<
  typeof SaveFieldInput,
  FormChanged,
  UserTx
> {
  return {
    permission: manage,
    input: SaveFieldInput,
    handler: ({ ctx, input }) =>
      changeForm(ctx.tx, input.formId, { kind: 'saveField', input }, async (before, after) => {
        const section = sectionOf(after, input.sectionId);
        const old = sectionOf(before, input.sectionId);
        const field = input.fieldId
          ? section?.fields.find((f) => f.id === input.fieldId)
          : section?.fields.find((f) => !old?.fields.some((o) => o.id === f.id));
        if (!field) throw new db.NeedsFormRefused('not_found');
        await db.writeField(ctx.tx, input.formId, input.sectionId, field, input.fieldId === undefined);
      }),
    audit: audit('field_saved', (input: z.output<typeof SaveFieldInput>) => ({
      sectionId: input.sectionId,
      fieldId: input.fieldId ?? null,
      type: input.type,
    })),
  };
}

export function setFieldVisibleActionDefinition(): ActionDefinition<
  typeof SetFieldVisibleInput,
  FormChanged,
  UserTx
> {
  return {
    permission: manage,
    input: SetFieldVisibleInput,
    handler: ({ ctx, input }) =>
      changeForm(ctx.tx, input.formId, { kind: 'setFieldVisible', ...input }, async (_b, after) => {
        const { section, field } = fieldOf(after, input.fieldId);
        await db.writeField(ctx.tx, input.formId, section.id, field, false);
      }),
    audit: audit('field_visibility_changed', (input: z.output<typeof SetFieldVisibleInput>) => ({
      fieldId: input.fieldId,
      visible: input.visible,
    })),
  };
}

export function setFieldRequiredActionDefinition(): ActionDefinition<
  typeof SetFieldRequiredInput,
  FormChanged,
  UserTx
> {
  return {
    permission: manage,
    input: SetFieldRequiredInput,
    handler: ({ ctx, input }) =>
      changeForm(ctx.tx, input.formId, { kind: 'setFieldRequired', ...input }, async (_b, after) => {
        const { section, field } = fieldOf(after, input.fieldId);
        await db.writeField(ctx.tx, input.formId, section.id, field, false);
      }),
    audit: audit('field_requirement_changed', (input: z.output<typeof SetFieldRequiredInput>) => ({
      fieldId: input.fieldId,
      required: input.required,
    })),
  };
}

export function moveFieldActionDefinition(): ActionDefinition<
  typeof MoveFieldInput,
  FormChanged,
  UserTx
> {
  return {
    permission: manage,
    input: MoveFieldInput,
    handler: ({ ctx, input }) =>
      changeForm(ctx.tx, input.formId, { kind: 'moveField', ...input }, async (_b, after) => {
        const { section } = fieldOf(after, input.fieldId);
        await db.orderFields(
          ctx.tx,
          section.id,
          section.fields.map((f) => f.id),
        );
      }),
    audit: audit('field_moved', (input: z.output<typeof MoveFieldInput>) => ({
      fieldId: input.fieldId,
      direction: input.direction,
    })),
  };
}

export function deleteFieldActionDefinition(): ActionDefinition<
  typeof FieldRefInput,
  FormChanged,
  UserTx
> {
  return {
    permission: manage,
    input: FieldRefInput,
    handler: ({ ctx, input }) =>
      changeForm(ctx.tx, input.formId, { kind: 'deleteField', ...input }, () =>
        db.deleteField(ctx.tx, input.formId, input.fieldId),
      ),
    audit: audit('field_deleted', (input: z.output<typeof FieldRefInput>) => ({
      fieldId: input.fieldId,
    })),
  };
}
