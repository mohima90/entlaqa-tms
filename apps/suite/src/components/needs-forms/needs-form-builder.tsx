'use client';
import type { AppError } from '@jadarat/platform-core';
import {
  type NeedsFormDefinition,
  type NeedsFormField,
  type NeedsFormSection,
  localized,
} from '@jadarat/tms/needs-forms';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  Spinner,
  cn,
  toast,
} from '@jadarat/ui';
import { type ReactNode, useMemo, useState, useTransition } from 'react';
import type { FormResult } from '../../lib/needs-forms-api';
import { previewForm } from '../../lib/needs-forms-preview';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { FIELD_TYPE_ICON, FieldInspector, type FieldDialogValues } from './field-inspector';
import { type NeedsFormAnswers, NeedsFormRenderer } from './needs-form-renderer';
import { SectionInspector, type SectionDialogValues } from './section-inspector';
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
  | { readonly kind: 'section'; readonly sectionId: string | null; readonly key: number }
  | {
      readonly kind: 'field';
      readonly sectionId: string;
      readonly fieldId: string | null;
      readonly key: number;
    }
  | null;
type Deleting =
  | { readonly kind: 'section'; readonly section: NeedsFormSection }
  | { readonly kind: 'field'; readonly field: NeedsFormField }
  | null;
type Dragging =
  | { readonly kind: 'section'; readonly index: number }
  | {
      readonly kind: 'field';
      readonly sectionId: string;
      readonly fieldId: string;
      readonly index: number;
    }
  | null;

const MENU_TRIGGER =
  'grid size-9 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11';

function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[12.5px] font-medium',
        tone === 'brand'
          ? 'border-primary/30 bg-primary-subtle text-primary-text'
          : 'border-border bg-surface text-text-muted',
      )}
    >
      {children}
    </span>
  );
}

/**
 * The needs-form builder (T-M3-10; redesign package 4 — Maze's three panes): an outline of the sections and
 * fields (type icons, tags: fixed, repeatable 1–50, hidden, the condition; a ⋯ menu per row with Move up /
 * Move down, Show / Hide, Required / Optional and Delete; pointer-only drag handles that do the same moves),
 * an inspector pane with the section or field settings (instead of the dialogs; «Save field») and an
 * always-visible preview — the real renderer — in English or Arabic, with the field being edited outlined.
 * «All changes saved» / «Saving…» replaces a toast per click. Phones: Outline / Preview tabs. A locked form,
 * or a reader without the design permission, sees the same page without the controls.
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
  const [answers, setAnswers] = useState<NeedsFormAnswers>({});
  const [previewLocale, setPreviewLocale] = useState<'ar' | 'en'>(locale);
  const [tab, setTab] = useState<'outline' | 'preview'>('outline');
  const [dragging, setDragging] = useState<Dragging>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  // A drop whose moves failed partway: the ones that worked are saved, the rest is not.
  const [notSaved, setNotSaved] = useState(false);
  const [inspectorKey, setInspectorKey] = useState(0);

  if (!loaded) return null;
  if (!form) {
    return (
      <Alert tone="warning" data-testid="needs-form-not-found">
        {text('notFound')}
      </Alert>
    );
  }
  const current: NeedsFormDefinition = form;

  const locked = current.lockedAt !== null;
  const editable = props.canManage && !locked;
  const name = localized(current.name, locale);
  const fieldCount = current.sections.reduce((n, s) => n + s.fields.length, 0);

  function failed(error: AppError, inPane: boolean) {
    if (sessionRefused(error)) return;
    const words = needsFormsErrorText(error, text, props.errors);
    if (inPane) {
      setFieldErrors(fieldErrorTexts(error, text));
      setMessage(words);
    } else toast.error(words);
  }

  /** One save; «All changes saved» says it worked (no toast per click). */
  function run(
    work: () => Promise<FormResult>,
    options: { inPane?: boolean; done?: (form: NeedsFormDefinition) => void } = {},
  ) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        failed(result.error, options.inPane ?? false);
        return;
      }
      setNotSaved(false);
      setForm(result.value.form);
      setMessage(null);
      setFieldErrors({});
      options.done?.(result.value.form);
    });
  }

  /** A drop: the same Move up / Move down, once per place moved. */
  function moveBy(move: (direction: 'up' | 'down') => Promise<FormResult>, by: number) {
    if (by === 0 || pending) return;
    startTransition(async () => {
      let saved: NeedsFormDefinition | null = null;
      for (let i = 0; i < Math.abs(by); i++) {
        const result = await move(by < 0 ? 'up' : 'down');
        if (!result.ok) {
          // The moves that worked are saved: show them, then the error and «Not saved».
          if (saved) setForm(saved);
          setNotSaved(true);
          failed(result.error, false);
          return;
        }
        saved = result.value.form;
      }
      if (saved) setForm(saved);
      setNotSaved(false);
    });
  }

  function open(next: Exclude<Editing, null>) {
    setMessage(null);
    setFieldErrors({});
    setInspectorKey((k) => k + 1);
    setEditing({ ...next, key: inspectorKey + 1 });
  }

  const editingSection =
    editing?.kind === 'section' && editing.sectionId
      ? (current.sections.find((s) => s.id === editing.sectionId) ?? null)
      : null;
  const fieldSection =
    editing?.kind === 'field'
      ? (current.sections.find((s) => s.id === editing.sectionId) ?? null)
      : null;
  const editingField =
    editing?.kind === 'field' && editing.fieldId
      ? (fieldSection?.fields.find((f) => f.id === editing.fieldId) ?? null)
      : null;

  function saveSection(values: SectionDialogValues) {
    if (editing?.kind !== 'section') return;
    const before = new Set(current.sections.map((s) => s.id));
    const sectionId = editing.sectionId;
    run(
      () => api.saveSection({ formId: current.id, ...(sectionId ? { sectionId } : {}), ...values }),
      {
        inPane: true,
        done: (saved) => {
          const added = saved.sections.find((s) => !before.has(s.id));
          if (!sectionId && added) {
            setEditing({ kind: 'section', sectionId: added.id, key: inspectorKey + 1 });
            setInspectorKey((k) => k + 1);
          }
        },
      },
    );
  }

  function saveField(values: FieldDialogValues) {
    if (editing?.kind !== 'field' || !fieldSection) return;
    const sectionId = fieldSection.id;
    const fieldId = editing.fieldId;
    const before = new Set(fieldSection.fields.map((f) => f.id));
    run(
      () =>
        api.saveField({
          formId: current.id,
          sectionId,
          ...(fieldId ? { fieldId } : {}),
          ...values,
          options: [...values.options],
        }),
      {
        inPane: true,
        done: (saved) => {
          setCollapsed((c) => new Set([...c].filter((id) => id !== sectionId)));
          // A new field stays open in the inspector (and outlined in the preview) once saved.
          const added = saved.sections
            .find((s) => s.id === sectionId)
            ?.fields.find((f) => !before.has(f.id));
          if (!fieldId && added) {
            setEditing({ kind: 'field', sectionId, fieldId: added.id, key: inspectorKey + 1 });
            setInspectorKey((k) => k + 1);
          }
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

  const outline = (
    <section
      aria-labelledby="builder-outline-title"
      className="flex flex-col gap-3 rounded-[22px] border border-border bg-surface p-3.5 shadow-2 md:p-4"
      data-testid="builder-outline"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 id="builder-outline-title" className="m-0 text-lg font-bold">
          {text('outline')}
        </h2>
        {editable ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              open({ kind: 'section', sectionId: null, key: 0 });
            }}
            data-testid="section-add"
          >
            <Icon name="plus" />
            {text('addSection')}
          </Button>
        ) : null}
      </div>
      <ol className="m-0 flex list-none flex-col gap-3 p-0" data-testid="needs-form-sections">
        {current.sections.map((section, sectionIndex) => {
          const isOpen = !collapsed.has(section.id);
          const sectionName = localized(section.name, locale);
          const system = section.fields.some((f) => f.systemKey !== null);
          const bodyId = `section-body-${section.id}`;
          const selected = editing?.kind === 'section' && editing.sectionId === section.id;
          return (
            <li key={section.id}>
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only a drop target of the pointer-only drag handle; the row menu's Move up / Move down are the keyboard way (WCAG 2.5.7) */}
              <section
                aria-labelledby={`section-title-${section.id}`}
                className={cn(
                  'flex flex-col gap-2 rounded-[18px] border bg-surface-sunken p-2',
                  selected ? 'border-primary' : 'border-border',
                  section.visible ? '' : 'opacity-75',
                )}
                data-testid="builder-section"
                data-section-id={section.id}
                onDragOver={(event) => {
                  if (dragging?.kind === 'section') event.preventDefault();
                }}
                onDrop={(event) => {
                  if (dragging?.kind !== 'section' || pending) return;
                  event.preventDefault();
                  const from = dragging.index;
                  const moving = current.sections[from];
                  setDragging(null);
                  if (moving) {
                    moveBy(
                      (direction) => api.moveSection(current.id, moving.id, direction),
                      sectionIndex - from,
                    );
                  }
                }}
              >
                <div className="flex items-center gap-1.5">
                  {editable ? (
                    <span
                      aria-hidden="true"
                      draggable={!pending}
                      onDragStart={() => {
                        setDragging({ kind: 'section', index: sectionIndex });
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                      }}
                      className="hidden h-9 w-6 cursor-grab place-items-center text-text-subtle pointer-fine:grid"
                    >
                      <Icon name="menu" className="size-4" />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={MENU_TRIGGER}
                    aria-expanded={isOpen}
                    aria-controls={bodyId}
                    aria-label={
                      isOpen
                        ? text('collapseSection', { name: sectionName })
                        : text('expandSection', { name: sectionName })
                    }
                    onClick={() => {
                      setCollapsed((c) => {
                        const next = new Set(c);
                        if (isOpen) next.add(section.id);
                        else next.delete(section.id);
                        return next;
                      });
                    }}
                    data-testid="section-expand"
                  >
                    <Icon name={isOpen ? 'chevron-down' : 'chevron-end'} />
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
                    <h3 id={`section-title-${section.id}`} className="m-0 text-[15px] font-bold">
                      {editable ? (
                        <button
                          type="button"
                          className="text-start hover:underline"
                          onClick={() => {
                            open({ kind: 'section', sectionId: section.id, key: 0 });
                          }}
                          data-testid="section-edit"
                        >
                          {sectionName}
                        </button>
                      ) : (
                        sectionName
                      )}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1">
                      {system ? (
                        <Tag>
                          <Icon name="lock" className="size-3" />
                          {text('systemBadge')}
                        </Tag>
                      ) : null}
                      {section.repeatable ? (
                        <Tag tone="brand">
                          <Icon name="repeat" className="size-3" />
                          {text('repeatableBadge', {
                            min: section.minEntries,
                            max: section.maxEntries,
                          })}
                        </Tag>
                      ) : null}
                      <Tag>{text('fieldsCount', { count: section.fields.length })}</Tag>
                      {!section.visible ? <Tag>{text('hiddenBadge')}</Tag> : null}
                    </div>
                  </div>
                  {editable ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={MENU_TRIGGER}
                        aria-label={text('rowActions', { name: sectionName })}
                        disabled={pending}
                        data-testid="section-menu"
                      >
                        <Icon name="more" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          onSelect={() => {
                            open({ kind: 'section', sectionId: section.id, key: 0 });
                          }}
                        >
                          <Icon name="pencil" />
                          {text('editSection', { name: sectionName })}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={sectionIndex === 0}
                          onSelect={() => {
                            run(() => api.moveSection(current.id, section.id, 'up'));
                          }}
                          data-testid="section-move-up"
                        >
                          <Icon name="arrow-up" />
                          {text('moveSectionUp', { name: sectionName })}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={sectionIndex === current.sections.length - 1}
                          onSelect={() => {
                            run(() => api.moveSection(current.id, section.id, 'down'));
                          }}
                          data-testid="section-move-down"
                        >
                          <Icon name="arrow-down" />
                          {text('moveSectionDown', { name: sectionName })}
                        </DropdownMenuItem>
                        {!system ? (
                          <>
                            <DropdownMenuItem
                              onSelect={() => {
                                run(() =>
                                  api.setSectionVisible(current.id, section.id, !section.visible),
                                );
                              }}
                              data-testid="section-toggle-visible"
                            >
                              <Icon name={section.visible ? 'eye-off' : 'eye'} />
                              {section.visible
                                ? text('hideSection', { name: sectionName })
                                : text('showSection', { name: sectionName })}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              tone="danger"
                              onSelect={() => {
                                setDeleting({ kind: 'section', section });
                              }}
                              data-testid="section-delete"
                            >
                              <Icon name="trash" />
                              {text('deleteSection', { name: sectionName })}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                <div id={bodyId} hidden={!isOpen} className="flex flex-col gap-1.5">
                  {section.fields.length === 0 ? (
                    <p className="m-0 px-2 text-sm text-text-muted">{text('noFields')}</p>
                  ) : (
                    <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                      {section.fields.map((field, fieldIndex) => {
                        const label = fieldName(field);
                        const condition = conditionText(section, field);
                        const fixed = field.systemKey !== null;
                        const isSelected =
                          editing?.kind === 'field' && editing.fieldId === field.id;
                        const summary = (
                          <>
                            <span
                              className={cn(
                                'block text-sm font-semibold [overflow-wrap:anywhere]',
                                !field.visible && 'line-through',
                              )}
                              data-testid="builder-field-label"
                            >
                              {label}
                            </span>
                            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-text-muted">
                              <span>
                                {text(`types.${field.type}`)} ·{' '}
                                {field.required ? text('required') : text('optional')}
                              </span>
                              {field.options.length > 0 ? (
                                <span>{text('optionsCount', { count: field.options.length })}</span>
                              ) : null}
                              {!field.visible ? <span>{text('hiddenBadge')}</span> : null}
                            </span>
                            {fixed || condition ? (
                              <span className="mt-1 flex flex-wrap gap-1">
                                {fixed ? (
                                  <Tag>
                                    <Icon name="lock" className="size-3" />
                                    {text('fixedField')}
                                  </Tag>
                                ) : null}
                                {condition ? (
                                  <span
                                    className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary-text"
                                    data-testid="builder-field-condition"
                                  >
                                    {condition}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                          </>
                        );
                        return (
                          <li
                            key={field.id}
                            className={cn(
                              'flex items-center gap-1.5 rounded-[14px] border bg-surface px-1.5 py-1.5',
                              isSelected ? 'border-primary bg-primary-subtle' : 'border-border',
                              dragging?.kind === 'field' &&
                                dragging.fieldId === field.id &&
                                'opacity-60',
                            )}
                            data-testid="builder-field"
                            data-field-id={field.id}
                          >
                            {editable ? (
                              <span
                                aria-hidden="true"
                                draggable={!pending}
                                onDragStart={() => {
                                  setDragging({
                                    kind: 'field',
                                    sectionId: section.id,
                                    fieldId: field.id,
                                    index: fieldIndex,
                                  });
                                }}
                                onDragEnd={() => {
                                  setDragging(null);
                                }}
                                className="hidden h-9 w-6 cursor-grab place-items-center text-text-subtle pointer-fine:grid"
                              >
                                <Icon name="menu" className="size-4" />
                              </span>
                            ) : null}
                            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- only a drop target of the pointer-only drag handle; the row menu's Move up / Move down are the keyboard way (WCAG 2.5.7) */}
                            <div
                              className="flex min-w-0 flex-1 items-center gap-2.5"
                              onDragOver={(event) => {
                                if (dragging?.kind === 'field' && dragging.sectionId === section.id)
                                  event.preventDefault();
                              }}
                              onDrop={(event) => {
                                if (
                                  pending ||
                                  dragging?.kind !== 'field' ||
                                  dragging.sectionId !== section.id
                                )
                                  return;
                                event.preventDefault();
                                const moving = dragging;
                                setDragging(null);
                                moveBy(
                                  (direction) =>
                                    api.moveField(current.id, moving.fieldId, direction),
                                  fieldIndex - moving.index,
                                );
                              }}
                            >
                              <span
                                aria-hidden="true"
                                className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-text"
                              >
                                <Icon name={FIELD_TYPE_ICON[field.type]} className="size-4" />
                              </span>
                              {editable ? (
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 py-1 text-start"
                                  aria-current={isSelected ? 'true' : undefined}
                                  onClick={() => {
                                    open({
                                      kind: 'field',
                                      sectionId: section.id,
                                      fieldId: field.id,
                                      key: 0,
                                    });
                                  }}
                                  data-testid="field-edit"
                                >
                                  {summary}
                                </button>
                              ) : (
                                <div className="min-w-0 flex-1 py-1">{summary}</div>
                              )}
                            </div>
                            {editable ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  className={MENU_TRIGGER}
                                  aria-label={text('rowActions', { name: label })}
                                  disabled={pending}
                                  data-testid="field-menu"
                                >
                                  <Icon name="more" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                  {!fixed ? (
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        run(() =>
                                          api.setFieldRequired(
                                            current.id,
                                            field.id,
                                            !field.required,
                                          ),
                                        );
                                      }}
                                      data-testid="field-toggle-required"
                                    >
                                      <Icon name="check" />
                                      {field.required
                                        ? text('makeOptional', { name: label })
                                        : text('makeRequired', { name: label })}
                                    </DropdownMenuItem>
                                  ) : null}
                                  <DropdownMenuItem
                                    disabled={fieldIndex === 0}
                                    onSelect={() => {
                                      run(() => api.moveField(current.id, field.id, 'up'));
                                    }}
                                    data-testid="field-move-up"
                                  >
                                    <Icon name="arrow-up" />
                                    {text('moveFieldUp', { name: label })}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={fieldIndex === section.fields.length - 1}
                                    onSelect={() => {
                                      run(() => api.moveField(current.id, field.id, 'down'));
                                    }}
                                    data-testid="field-move-down"
                                  >
                                    <Icon name="arrow-down" />
                                    {text('moveFieldDown', { name: label })}
                                  </DropdownMenuItem>
                                  {!fixed ? (
                                    <>
                                      <DropdownMenuItem
                                        onSelect={() => {
                                          run(() =>
                                            api.setFieldVisible(
                                              current.id,
                                              field.id,
                                              !field.visible,
                                            ),
                                          );
                                        }}
                                        data-testid="field-toggle-visible"
                                      >
                                        <Icon name={field.visible ? 'eye-off' : 'eye'} />
                                        {field.visible
                                          ? text('hideField', { name: label })
                                          : text('showField', { name: label })}
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        tone="danger"
                                        onSelect={() => {
                                          setDeleting({ kind: 'field', field });
                                        }}
                                        data-testid="field-delete"
                                      >
                                        <Icon name="trash" />
                                        {text('deleteField', { name: label })}
                                      </DropdownMenuItem>
                                    </>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {editable ? (
                    <button
                      type="button"
                      className="flex min-h-11 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-border-strong font-semibold text-primary-text hover:bg-primary-subtle disabled:opacity-60"
                      disabled={pending}
                      onClick={() => {
                        open({ kind: 'field', sectionId: section.id, fieldId: null, key: 0 });
                      }}
                      data-testid="field-add"
                    >
                      <Icon name="plus" className="size-4" />
                      {text('addField')}
                    </button>
                  ) : null}
                </div>
              </section>
            </li>
          );
        })}
      </ol>
      {editable ? (
        <p className="m-0 flex items-start gap-2 px-1 text-[13px] text-text-muted">
          <Icon name="menu" className="mt-0.5 size-3.5" />
          {text('dragHint')}
        </p>
      ) : null}
    </section>
  );

  const inspector =
    editing?.kind === 'section' && editable ? (
      <SectionInspector
        key={editing.key}
        locale={locale}
        section={editingSection}
        pending={pending}
        message={message}
        fieldErrors={fieldErrors}
        text={text}
        onClose={() => {
          setEditing(null);
        }}
        onSave={saveSection}
        onDelete={
          editingSection && !editingSection.fields.some((f) => f.systemKey !== null)
            ? () => {
                setDeleting({ kind: 'section', section: editingSection });
              }
            : undefined
        }
      />
    ) : editing?.kind === 'field' && editable && fieldSection ? (
      <FieldInspector
        key={editing.key}
        locale={locale}
        section={fieldSection}
        field={editingField}
        pending={pending}
        message={message}
        fieldErrors={fieldErrors}
        text={text}
        unsavedText={text('unsavedChanges')}
        onClose={() => {
          setEditing(null);
        }}
        onSave={saveField}
        onDelete={
          editingField?.systemKey === null
            ? () => {
                setDeleting({ kind: 'field', field: editingField });
              }
            : undefined
        }
      />
    ) : null;

  const preview = (
    <section
      aria-labelledby="builder-preview-title"
      className="flex flex-col gap-3 rounded-[22px] border border-border bg-surface p-3.5 shadow-2 md:p-4.5"
      data-testid="needs-form-preview-pane"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="builder-preview-title" className="m-0 flex items-center gap-2 text-lg font-bold">
          <Icon name="eye" className="size-4" />
          {text('preview')}
        </h2>
        <div
          role="group"
          aria-label={text('previewLanguage')}
          className="flex gap-1 rounded-full bg-surface-sunken p-1"
        >
          {(['en', 'ar'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              lang={lang}
              aria-pressed={previewLocale === lang}
              onClick={() => {
                setPreviewLocale(lang);
              }}
              className={cn(
                'min-h-9 rounded-full px-3.5 text-sm font-semibold pointer-coarse:min-h-11',
                previewLocale === lang ? 'bg-surface text-text shadow-1' : 'text-text-muted',
              )}
              data-testid={`preview-language-${lang}`}
            >
              {lang === 'en' ? 'English' : 'العربية'}
            </button>
          ))}
        </div>
      </div>
      <p className="m-0 text-sm text-text-muted">{text('previewHint')}</p>
      <div lang={previewLocale} dir={previewLocale === 'ar' ? 'rtl' : 'ltr'}>
        <NeedsFormRenderer
          form={current}
          locale={previewLocale}
          answers={answers}
          onChange={setAnswers}
          texts={props.texts}
          idPrefix="preview"
          highlight={editing?.kind === 'field' ? (editing.fieldId ?? undefined) : undefined}
        />
      </div>
    </section>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <a
          href={props.libraryHref}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold"
        >
          <span className="inline-flex -scale-x-100">
            <Icon name="arrow-end" className="size-4" />
          </span>
          {text('back')}
        </a>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1
              className="m-0 text-[28px] font-bold leading-tight tracking-[-0.02em] md:text-4xl"
              data-testid="needs-form-title"
            >
              {name}
            </h1>
            {current.isDefault ? <Badge tone="brand">{text('defaultBadge')}</Badge> : null}
            {locked ? <Badge tone="warning">{text('lockedBadge')}</Badge> : null}
            {!current.isActive ? <Badge tone="neutral">{text('inactiveBadge')}</Badge> : null}
          </div>
          {editable ? (
            <p
              role="status"
              className={cn(
                'm-0 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold',
                pending
                  ? 'bg-surface-hover text-text-muted'
                  : notSaved
                    ? 'bg-warning-subtle text-warning'
                    : 'bg-success-subtle text-success',
              )}
              data-testid="builder-save-status"
            >
              {pending ? (
                <Spinner />
              ) : (
                <Icon name={notSaved ? 'warning' : 'success'} className="size-4" />
              )}
              {pending ? text('saving') : notSaved ? text('notSaved') : text('allSaved')}
            </p>
          ) : null}
        </div>
        <p className="m-0 max-w-4xl text-text-muted">
          <span className="me-2" data-testid="needs-form-stats">
            {text('statsCount', { sections: current.sections.length, fields: fieldCount })}
          </span>
          {text('builderIntro')}
        </p>
      </div>

      {props.mode === 'preview' ? (
        <Alert tone="info" data-testid="needs-forms-preview">
          {text('notConfigured')}
        </Alert>
      ) : null}
      {banner}

      <div
        role="group"
        aria-label={text('outline')}
        className="flex gap-1 rounded-full bg-surface-sunken p-1 2xl:hidden"
      >
        {(['outline', 'preview'] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
            }}
            className={cn(
              'flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold pointer-coarse:min-h-11',
              tab === key ? 'bg-surface text-text shadow-1' : 'text-text-muted',
            )}
            data-testid={`builder-tab-${key}`}
          >
            <Icon name={key === 'outline' ? 'form' : 'eye'} className="size-4" />
            {key === 'outline' ? text('outline') : text('preview')}
          </button>
        ))}
      </div>

      <div
        className={cn(
          'grid grid-cols-1 items-start gap-4',
          inspector
            ? 'lg:grid-cols-2 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)]'
            : '2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]',
        )}
      >
        <div className={cn('min-w-0', tab === 'preview' && 'max-2xl:hidden')}>{outline}</div>
        {inspector ? (
          <div
            className={cn('min-w-0 2xl:sticky 2xl:top-24', tab === 'preview' && 'max-2xl:hidden')}
          >
            {inspector}
          </div>
        ) : null}
        <div className={cn('min-w-0 2xl:sticky 2xl:top-24', tab === 'outline' && 'max-2xl:hidden')}>
          {preview}
        </div>
      </div>

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
        tone="danger"
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
                      ? api.deleteSection(current.id, target.section.id)
                      : api.deleteField(current.id, target.field.id),
                  {
                    done: () => {
                      setDeleting(null);
                      setEditing(null);
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
    </div>
  );
}
