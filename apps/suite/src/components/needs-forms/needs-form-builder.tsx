'use client';
import type { AppError } from '@jadarat/platform-core';
import {
  type NeedsFormDefinition,
  type NeedsFormField,
  type NeedsFormSection,
  localized,
} from '@jadarat/tms/needs-forms';
import { Alert, Badge, Button, Dialog, Icon, toast } from '@jadarat/ui';
import { type ReactNode, useMemo, useState, useTransition } from 'react';
import type { FormResult } from '../../lib/needs-forms-api';
import { previewForm } from '../../lib/needs-forms-preview';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { FieldDialog, type FieldDialogValues } from './field-dialog';
import { type NeedsFormAnswers, NeedsFormRenderer } from './needs-form-renderer';
import { SectionDialog, type SectionDialogValues } from './section-dialog';
import {
  type NeedsFormsMode,
  fieldErrorTexts,
  needsFormsErrorText,
  textsOf,
  useNeedsFormsApi,
  usePreviewSnapshot,
} from './use-needs-forms-api';

export interface NeedsFormBuilderProps {
  readonly mode: NeedsFormsMode;
  readonly locale: 'ar' | 'en';
  readonly formId: string;
  /** The form read on the server (live); the preview reads the tab's copy (null until then). */
  readonly initialForm: NeedsFormDefinition | null;
  readonly canManage: boolean;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly libraryHref: string;
}

type Editing =
  | { readonly kind: 'section'; readonly section: NeedsFormSection | null; readonly key: number }
  | {
      readonly kind: 'field';
      readonly section: NeedsFormSection;
      readonly field: NeedsFormField | null;
      readonly key: number;
    }
  | null;
type Deleting =
  | { readonly kind: 'section'; readonly section: NeedsFormSection }
  | { readonly kind: 'field'; readonly field: NeedsFormField }
  | null;

const iconButton =
  'grid size-9 shrink-0 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:size-11';

function IconButton(props: {
  label: string;
  icon: Parameters<typeof Icon>[0]['name'];
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  testId?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${iconButton} ${props.danger ? 'hover:text-danger' : ''}`}
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
      data-testid={props.testId}
    >
      <Icon name={props.icon} />
    </button>
  );
}

/**
 * The needs-form builder (T-M3-10; Kawadir's application-form builder with the agreed fixes): collapsible
 * section cards (badges: fixed fields, repeatable with min–max, number of fields, hidden), each with show /
 * hide, move up / down, edit and delete; field rows with required / optional, show / hide, move up / down,
 * edit and delete; the section and field dialogs; and a live preview (the reusable renderer). The training
 * topic and people fields are fixed. A locked form, or a reader without the design permission, sees the same
 * page without the controls.
 */
export function NeedsFormBuilder(props: NeedsFormBuilderProps) {
  const { locale } = props;
  const text = textsOf(props.texts, locale);
  const api = useNeedsFormsApi(props.mode);
  const sessionRefused = useSessionRefusal();
  const snapshot = usePreviewSnapshot(props.mode === 'preview');
  const stored = useMemo(
    () => (snapshot ? previewForm(snapshot, props.formId) : null),
    [snapshot, props.formId],
  );
  // The form after this page's last change; until then the server's (live) or the tab's copy (preview).
  const [changed, setForm] = useState<NeedsFormDefinition | null>(null);
  const form = changed ?? (props.mode === 'preview' ? stored : props.initialForm);
  const loaded = props.mode === 'live' || snapshot !== null;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Deleting>(null);
  const [previewing, setPreviewing] = useState(false);
  const [answers, setAnswers] = useState<NeedsFormAnswers>({});
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [dialogKey, setDialogKey] = useState(0);

  if (!loaded) return null;
  if (!form) {
    return (
      <Alert tone="warning" data-testid="needs-form-not-found">
        {text('notFound')}
      </Alert>
    );
  }

  const locked = form.lockedAt !== null;
  const editable = props.canManage && !locked;
  const name = localized(form.name, locale);

  function failed(error: AppError, inDialog: boolean) {
    if (sessionRefused(error)) return;
    const words = needsFormsErrorText(error, text, props.errors);
    if (inDialog) {
      setFieldErrors(fieldErrorTexts(error, text));
      setMessage(words);
    } else toast.error(words);
  }

  function run(
    work: () => Promise<FormResult>,
    options: { inDialog?: boolean; done?: () => void } = {},
  ) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        failed(result.error, options.inDialog ?? false);
        return;
      }
      setForm(result.value.form);
      options.done?.();
      if (options.inDialog) toast.success(text('saved'));
    });
  }

  function openEditing(next: Exclude<Editing, null>) {
    setMessage(null);
    setFieldErrors({});
    setDialogKey((k) => k + 1);
    setEditing(next);
  }

  const closeEditing = () => {
    if (!pending) setEditing(null);
  };

  function saveSection(values: SectionDialogValues) {
    if (editing?.kind !== 'section' || !form) return;
    const sectionId = editing.section?.id;
    run(
      () =>
        api.saveSection({
          formId: form.id,
          ...(sectionId ? { sectionId } : {}),
          ...values,
        }),
      {
        inDialog: true,
        done: () => {
          setEditing(null);
        },
      },
    );
  }

  function saveField(values: FieldDialogValues) {
    if (editing?.kind !== 'field' || !form) return;
    const { section, field } = editing;
    run(
      () =>
        api.saveField({
          formId: form.id,
          sectionId: section.id,
          ...(field ? { fieldId: field.id } : {}),
          ...values,
          options: [...values.options],
        }),
      {
        inDialog: true,
        done: () => {
          setEditing(null);
          setCollapsed((c) => new Set([...c].filter((id) => id !== section.id)));
        },
      },
    );
  }

  const fieldName = (field: NeedsFormField) => localized(field.label, locale);
  const conditionText = (section: NeedsFormSection, field: NeedsFormField): string | null => {
    if (!field.condition) return null;
    const trigger = section.fields.find((f) => f.id === field.condition?.fieldId);
    const option = trigger?.options.find((o) => o.value === field.condition?.value);
    return trigger && option
      ? text('conditional', { field: fieldName(trigger), value: localized(option.label, locale) })
      : null;
  };

  const allIds = form.sections.map((s) => s.id);
  let banner: ReactNode = null;
  if (locked) {
    banner = (
      <Alert tone="warning" data-testid="needs-form-locked">
        {text('lockedBanner')}
      </Alert>
    );
  } else if (!props.canManage) {
    banner = (
      <Alert tone="info" data-testid="needs-form-read-only">
        {text('readOnlyBanner')}
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <a href={props.libraryHref} className="text-sm">
            {text('back')}
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 text-2xl font-bold tracking-tight" data-testid="needs-form-title">
              {name}
            </h1>
            {form.isDefault ? <Badge tone="info">{text('defaultBadge')}</Badge> : null}
            {locked ? <Badge tone="warning">{text('lockedBadge')}</Badge> : null}
            {!form.isActive ? <Badge tone="neutral">{text('inactiveBadge')}</Badge> : null}
          </div>
          <p className="m-0 max-w-3xl text-text-muted">{text('builderIntro')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border p-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCollapsed(new Set());
              }}
            >
              <Icon name="chevron-down" />
              {text('expandAll')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCollapsed(new Set(allIds));
              }}
            >
              <Icon name="chevron-up" />
              {text('collapseAll')}
            </Button>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setAnswers({});
              setPreviewing(true);
            }}
            data-testid="needs-form-preview-open"
          >
            <Icon name="eye" />
            {text('preview')}
          </Button>
          {editable ? (
            <Button
              onClick={() => {
                openEditing({ kind: 'section', section: null, key: dialogKey });
              }}
              data-testid="section-add"
            >
              <Icon name="plus" />
              {text('addSection')}
            </Button>
          ) : null}
        </div>
      </div>

      {props.mode === 'preview' ? (
        <Alert tone="info" data-testid="needs-forms-preview">
          {text('notConfigured')}
        </Alert>
      ) : null}
      {banner}

      <ol className="m-0 flex list-none flex-col gap-4 p-0" data-testid="needs-form-sections">
        {form.sections.map((section, sectionIndex) => {
          const open = !collapsed.has(section.id);
          const sectionName = localized(section.name, locale);
          const system = section.fields.some((f) => f.systemKey !== null);
          const bodyId = `section-body-${section.id}`;
          return (
            <li key={section.id}>
              <section
                aria-labelledby={`section-title-${section.id}`}
                className={`rounded-xl border border-border bg-surface shadow-1 ${section.visible ? '' : 'opacity-75'}`}
                data-testid="builder-section"
                data-section-id={section.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-text">
                      <Icon name="form" className="size-5" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <h2 id={`section-title-${section.id}`} className="m-0 text-lg font-semibold">
                        {sectionName}
                      </h2>
                      <div className="flex flex-wrap items-center gap-1">
                        {system ? (
                          <Badge tone="neutral">
                            <Icon name="lock" className="size-3" />
                            {text('systemBadge')}
                          </Badge>
                        ) : null}
                        {section.repeatable ? (
                          <Badge tone="info">
                            <Icon name="repeat" className="size-3" />
                            {text('repeatableBadge', {
                              min: section.minEntries,
                              max: section.maxEntries,
                            })}
                          </Badge>
                        ) : null}
                        <Badge tone="neutral">
                          {text('fieldsCount', { count: section.fields.length })}
                        </Badge>
                        {!section.visible ? (
                          <Badge tone="warning">{text('hiddenBadge')}</Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-0.5">
                    {editable ? (
                      <>
                        <IconButton
                          label={text('moveSectionUp', { name: sectionName })}
                          icon="arrow-up"
                          disabled={pending || sectionIndex === 0}
                          onClick={() => {
                            run(() => api.moveSection(form.id, section.id, 'up'));
                          }}
                          testId="section-move-up"
                        />
                        <IconButton
                          label={text('moveSectionDown', { name: sectionName })}
                          icon="arrow-down"
                          disabled={pending || sectionIndex === form.sections.length - 1}
                          onClick={() => {
                            run(() => api.moveSection(form.id, section.id, 'down'));
                          }}
                          testId="section-move-down"
                        />
                        {!system ? (
                          <IconButton
                            label={
                              section.visible
                                ? text('hideSection', { name: sectionName })
                                : text('showSection', { name: sectionName })
                            }
                            icon={section.visible ? 'eye' : 'eye-off'}
                            pressed={!section.visible}
                            disabled={pending}
                            onClick={() => {
                              run(() =>
                                api.setSectionVisible(form.id, section.id, !section.visible),
                              );
                            }}
                            testId="section-toggle-visible"
                          />
                        ) : null}
                        <IconButton
                          label={text('editSection', { name: sectionName })}
                          icon="pencil"
                          disabled={pending}
                          onClick={() => {
                            openEditing({ kind: 'section', section, key: dialogKey });
                          }}
                          testId="section-edit"
                        />
                        {!system ? (
                          <IconButton
                            label={text('deleteSection', { name: sectionName })}
                            icon="trash"
                            danger
                            disabled={pending}
                            onClick={() => {
                              setDeleting({ kind: 'section', section });
                            }}
                            testId="section-delete"
                          />
                        ) : null}
                      </>
                    ) : null}
                    <button
                      type="button"
                      className={iconButton}
                      aria-expanded={open}
                      aria-controls={bodyId}
                      aria-label={
                        open
                          ? text('collapseSection', { name: sectionName })
                          : text('expandSection', { name: sectionName })
                      }
                      onClick={() => {
                        setCollapsed((c) => {
                          const next = new Set(c);
                          if (open) next.add(section.id);
                          else next.delete(section.id);
                          return next;
                        });
                      }}
                      data-testid="section-expand"
                    >
                      <Icon name={open ? 'chevron-up' : 'chevron-down'} />
                    </button>
                  </div>
                </div>
                <div id={bodyId} hidden={!open} className="border-t border-border p-4">
                  {section.fields.length === 0 ? (
                    <p className="m-0 mb-3 text-sm text-text-muted">{text('noFields')}</p>
                  ) : (
                    <ol className="m-0 flex list-none flex-col gap-2 p-0">
                      {section.fields.map((field, fieldIndex) => {
                        const label = fieldName(field);
                        const condition = conditionText(section, field);
                        const fixed = field.systemKey !== null;
                        return (
                          <li
                            key={field.id}
                            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2 ${field.visible ? '' : 'opacity-60'}`}
                            data-testid="builder-field"
                            data-field-id={field.id}
                          >
                            <div className="flex min-w-0 flex-col">
                              <span
                                className="text-sm font-medium"
                                data-testid="builder-field-label"
                              >
                                {label}
                                {field.required ? (
                                  <span className="ms-1 text-danger" aria-hidden="true">
                                    *
                                  </span>
                                ) : null}
                              </span>
                              <span className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                                <span>{text(`types.${field.type}`)}</span>
                                {field.options.length > 0 ? (
                                  <span>
                                    {text('optionsCount', { count: field.options.length })}
                                  </span>
                                ) : null}
                                {fixed ? <span>{text('fixedField')}</span> : null}
                                {condition ? (
                                  <span
                                    className="text-warning-strong"
                                    data-testid="builder-field-condition"
                                  >
                                    {condition}
                                  </span>
                                ) : null}
                                {!field.visible ? <span>{text('hiddenBadge')}</span> : null}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-0.5">
                              {editable && !fixed ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label={
                                    field.required
                                      ? text('makeOptional', { name: label })
                                      : text('makeRequired', { name: label })
                                  }
                                  disabled={pending}
                                  onClick={() => {
                                    run(() =>
                                      api.setFieldRequired(form.id, field.id, !field.required),
                                    );
                                  }}
                                  data-testid="field-toggle-required"
                                >
                                  {field.required ? text('required') : text('optional')}
                                </Button>
                              ) : (
                                <span className="px-2 text-xs text-text-muted">
                                  {field.required ? text('required') : text('optional')}
                                </span>
                              )}
                              {editable ? (
                                <>
                                  <IconButton
                                    label={text('moveFieldUp', { name: label })}
                                    icon="arrow-up"
                                    disabled={pending || fieldIndex === 0}
                                    onClick={() => {
                                      run(() => api.moveField(form.id, field.id, 'up'));
                                    }}
                                    testId="field-move-up"
                                  />
                                  <IconButton
                                    label={text('moveFieldDown', { name: label })}
                                    icon="arrow-down"
                                    disabled={pending || fieldIndex === section.fields.length - 1}
                                    onClick={() => {
                                      run(() => api.moveField(form.id, field.id, 'down'));
                                    }}
                                    testId="field-move-down"
                                  />
                                  {!fixed ? (
                                    <IconButton
                                      label={
                                        field.visible
                                          ? text('hideField', { name: label })
                                          : text('showField', { name: label })
                                      }
                                      icon={field.visible ? 'eye' : 'eye-off'}
                                      pressed={!field.visible}
                                      disabled={pending}
                                      onClick={() => {
                                        run(() =>
                                          api.setFieldVisible(form.id, field.id, !field.visible),
                                        );
                                      }}
                                      testId="field-toggle-visible"
                                    />
                                  ) : null}
                                  <IconButton
                                    label={text('editField', { name: label })}
                                    icon="pencil"
                                    disabled={pending}
                                    onClick={() => {
                                      openEditing({
                                        kind: 'field',
                                        section,
                                        field,
                                        key: dialogKey,
                                      });
                                    }}
                                    testId="field-edit"
                                  />
                                  {!fixed ? (
                                    <IconButton
                                      label={text('deleteField', { name: label })}
                                      icon="trash"
                                      danger
                                      disabled={pending}
                                      onClick={() => {
                                        setDeleting({ kind: 'field', field });
                                      }}
                                      testId="field-delete"
                                    />
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {editable ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      onClick={() => {
                        openEditing({ kind: 'field', section, field: null, key: dialogKey });
                      }}
                      data-testid="field-add"
                    >
                      <Icon name="plus" />
                      {text('addField')}
                    </Button>
                  ) : null}
                </div>
              </section>
            </li>
          );
        })}
      </ol>

      {editing?.kind === 'section' ? (
        <SectionDialog
          key={dialogKey}
          open
          section={editing.section}
          pending={pending}
          message={message}
          fieldErrors={fieldErrors}
          text={text}
          onClose={closeEditing}
          onSave={saveSection}
        />
      ) : null}
      {editing?.kind === 'field' ? (
        <FieldDialog
          key={dialogKey}
          open
          locale={locale}
          section={form.sections.find((s) => s.id === editing.section.id) ?? editing.section}
          field={editing.field}
          pending={pending}
          message={message}
          fieldErrors={fieldErrors}
          text={text}
          onClose={closeEditing}
          onSave={saveField}
        />
      ) : null}

      <Dialog
        open={deleting !== null}
        onClose={() => {
          if (!pending) setDeleting(null);
        }}
        title={deleting?.kind === 'section' ? text('deleteSectionTitle') : text('deleteFieldTitle')}
        description={
          deleting?.kind === 'section'
            ? text('deleteSectionDesc', { name: localized(deleting.section.name, locale) })
            : deleting?.kind === 'field'
              ? text('deleteFieldDesc', { name: fieldName(deleting.field) })
              : ''
        }
        closeLabel={text('close')}
        size="sm"
        data-testid="builder-delete-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setDeleting(null);
              }}
            >
              {text('keep')}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                const target = deleting;
                if (!target) return;
                run(
                  () =>
                    target.kind === 'section'
                      ? api.deleteSection(form.id, target.section.id)
                      : api.deleteField(form.id, target.field.id),
                  {
                    done: () => {
                      setDeleting(null);
                    },
                  },
                );
              }}
              data-testid="builder-delete-confirm"
            >
              {text('deleteItem')}
            </Button>
          </>
        }
      />

      <Dialog
        open={previewing}
        onClose={() => {
          setPreviewing(false);
        }}
        title={text('previewTitle', { name })}
        description={text('previewHint')}
        closeLabel={text('close')}
        size="lg"
        data-testid="needs-form-preview-dialog"
      >
        {previewing ? (
          <NeedsFormRenderer
            form={form}
            locale={locale}
            answers={answers}
            onChange={setAnswers}
            texts={props.texts}
            idPrefix="preview"
          />
        ) : null}
      </Dialog>
    </div>
  );
}
