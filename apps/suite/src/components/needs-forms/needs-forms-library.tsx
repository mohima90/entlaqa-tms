'use client';
import type { AppError } from '@jadarat/platform-core';
import { type NeedsFormSummary, localized } from '@jadarat/tms/needs-forms';
import {
  Alert,
  Button,
  ChoiceCard,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  PageHeader,
  TextField,
  buttonClasses,
  cn,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useMemo, useState, useTransition } from 'react';
import { previewSummaries } from '../../lib/needs-forms-preview';
import type { LibraryResult } from '../../lib/needs-forms-api';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';
import {
  type NeedsFormsMode,
  fieldErrorTexts,
  needsFormsErrorText,
  textsOf,
  useNeedsFormsApi,
  usePreviewSnapshot,
} from './use-needs-forms-api';

export interface NeedsFormsLibraryProps {
  readonly mode: NeedsFormsMode;
  readonly locale: 'ar' | 'en';
  /** The forms read on the server (live); the preview reads the tab's copy. */
  readonly initialForms: readonly NeedsFormSummary[];
  readonly canManage: boolean;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** The builder's path without the form id (locale included). */
  readonly builderHref: string;
}

type DialogState =
  | { readonly kind: 'create' }
  | { readonly kind: 'duplicate'; readonly form: NeedsFormSummary }
  | { readonly kind: 'rename'; readonly form: NeedsFormSummary }
  | null;

const MENU_TRIGGER =
  'grid size-10 shrink-0 place-items-center rounded-full border border-border-strong text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-60 pointer-coarse:size-11';

/** A small drawing of a form (sections and fields from the counts only: the list returns no more). */
function Thumbnail({ sections, fields }: { sections: number; fields: number }) {
  const perSection = Math.max(1, Math.ceil(Math.min(fields, 6) / Math.max(sections, 1)));
  return (
    <div
      aria-hidden="true"
      className="flex h-[150px] items-end justify-center overflow-hidden border-b border-border bg-surface-sunken px-8 pt-4.5"
    >
      <div className="flex h-full w-full max-w-[210px] flex-col gap-2 rounded-t-xl border border-b-0 border-border bg-surface px-3.5 pt-4">
        <span className="h-1 w-2/5 rounded-full bg-border-strong" />
        {Array.from({ length: Math.min(sections, 2) }, (_, s) => (
          <span key={s} className="contents">
            {s > 0 ? <span className="mt-1 h-1 w-1/3 rounded-full bg-primary/40" /> : null}
            {Array.from({ length: perSection }, (_, i) => (
              <span key={i} className="contents">
                <span className="h-1 w-1/3 rounded-full bg-border" />
                <span className="h-2.5 rounded-md border border-border" />
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Planning → Needs forms (T-M3-10; redesign package 4 — HoneyBook / Klaviyo templates): one card per form
 * with a thumbnail, quiet tags (★ Default, Locked, Off) and the locked explanation, one Edit / View button and
 * a ⋯ menu (Rename · Duplicate · Set as default · Switch on/off · Delete, last, in red) for the L&D Manager
 * (view only for the Training Coordinator). «Create form» starts from the two fixed fields or from a copy of
 * a form (the Duplicate action); after Create or Duplicate the builder opens. Switching a form off can be
 * undone from the toast (Switch on). The default form cannot be switched off or deleted; a locked form (used
 * by a launched cycle) cannot be deleted.
 */
export function NeedsFormsLibrary(props: NeedsFormsLibraryProps) {
  const { locale, canManage } = props;
  const text = textsOf(props.texts, locale);
  const api = useNeedsFormsApi(props.mode);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const snapshot = usePreviewSnapshot(props.mode === 'preview');
  const stored = useMemo(() => (snapshot ? previewSummaries(snapshot) : []), [snapshot]);
  // The forms after this page's last change; until then the server's (live) or the tab's copy (preview).
  const [changed, setForms] = useState<readonly NeedsFormSummary[] | null>(null);
  const forms = changed ?? (props.mode === 'preview' ? stored : props.initialForms);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleting, setDeleting] = useState<NeedsFormSummary | null>(null);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [startFrom, setStartFrom] = useState<'blank' | 'copy'>('blank');
  const [copyOf, setCopyOf] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOf = (form: NeedsFormSummary) => localized(form.name, locale);
  const builder = (formId: string) => `${props.builderHref}/${formId}`;

  function failed(error: AppError, inDialog: boolean) {
    if (sessionRefused(error)) return;
    const words = needsFormsErrorText(error, text, props.errors);
    if (inDialog) {
      setFieldErrors(fieldErrorTexts(error, text));
      setMessage(words);
    } else toast.error(words);
  }

  function run(
    work: () => Promise<LibraryResult>,
    done: string,
    close: () => void,
    options: { inDialog?: boolean; openBuilder?: boolean; undo?: () => void } = {},
  ) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        failed(result.error, options.inDialog ?? false);
        return;
      }
      setForms(result.value.forms);
      close();
      toast.success(
        done,
        options.undo ? { action: { label: text('undo'), onClick: options.undo } } : undefined,
      );
      // After Create or Duplicate the new form opens in the builder (PO rule, redesign package 4).
      if (options.openBuilder) router.push(builder(result.value.formId));
    });
  }

  function open(next: Exclude<DialogState, null>) {
    setFieldErrors({});
    setMessage(null);
    if (next.kind === 'create') {
      setNameEn('');
      setNameAr('');
      setStartFrom('blank');
      setCopyOf(forms.find((f) => f.isDefault)?.id ?? forms[0]?.id ?? '');
    } else if (next.kind === 'duplicate') {
      setNameEn(`${next.form.name.en}${text('copySuffixEn')}`);
      setNameAr(`${next.form.name.ar}${text('copySuffixAr')}`);
    } else {
      setNameEn(next.form.name.en);
      setNameAr(next.form.name.ar);
    }
    setDialog(next);
  }

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (!dialog) return;
    const names = { nameEn, nameAr };
    const close = () => {
      setDialog(null);
    };
    if (dialog.kind === 'create') {
      if (startFrom === 'copy' && copyOf) {
        run(() => api.duplicate(copyOf, names), text('duplicated'), close, {
          inDialog: true,
          openBuilder: true,
        });
      } else {
        run(() => api.create(names), text('created'), close, {
          inDialog: true,
          openBuilder: true,
        });
      }
    } else if (dialog.kind === 'duplicate') {
      run(() => api.duplicate(dialog.form.id, names), text('duplicated'), close, {
        inDialog: true,
        openBuilder: true,
      });
    } else {
      run(() => api.rename(dialog.form.id, dialog.form.version, names), text('renamed'), close, {
        inDialog: true,
      });
    }
  }

  function switchActive(form: NeedsFormSummary) {
    const off = form.isActive;
    run(
      () => api.setActive(form.id, !form.isActive),
      off ? text('deactivated') : text('activated'),
      () => undefined,
      off
        ? {
            // Undo is the existing Switch on.
            undo: () => {
              run(
                () => api.setActive(form.id, true),
                text('activated'),
                () => undefined,
              );
            },
          }
        : {},
    );
  }

  const dialogTitle =
    dialog?.kind === 'duplicate'
      ? text('duplicateTitle')
      : dialog?.kind === 'rename'
        ? text('renameTitle')
        : text('createTitle');
  const dialogDesc =
    dialog?.kind === 'duplicate'
      ? text('duplicateDesc', { name: nameOf(dialog.form) })
      : dialog?.kind === 'rename'
        ? text('renameDesc', { name: nameOf(dialog.form) })
        : text('createDesc');
  const submitLabel =
    dialog?.kind === 'duplicate'
      ? text('duplicate')
      : dialog?.kind === 'rename'
        ? text('save')
        : text('create');
  const copyForm = forms.find((f) => f.id === copyOf);

  return (
    <>
      <PageHeader
        breadcrumbsLabel={text('breadcrumbLabel')}
        breadcrumbs={[{ label: text('breadcrumbPlanning') }, { label: text('title') }]}
        title={text('title')}
        description={text('intro')}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                open({ kind: 'create' });
              }}
              data-testid="needs-form-create"
            >
              <Icon name="plus" />
              {text('create')}
            </Button>
          ) : null
        }
      />
      {props.mode === 'preview' ? (
        <Alert tone="info" className="mb-6" data-testid="needs-forms-preview">
          {text('notConfigured')}
        </Alert>
      ) : null}
      {forms.length === 0 ? (
        <EmptyState icon="form" title={text('title')} description={text('intro')} />
      ) : (
        <ul
          className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-3"
          aria-label={text('title')}
          data-testid="needs-forms-list"
        >
          {forms.map((form) => {
            const name = nameOf(form);
            const titleId = `needs-form-${form.id}`;
            const locked = form.lockedAt !== null;
            const editable = canManage && !locked;
            return (
              <li key={form.id}>
                <article
                  aria-labelledby={titleId}
                  className={cn(
                    'flex h-full flex-col overflow-hidden rounded-[22px] border border-border bg-surface shadow-1 hover:border-border-strong',
                    form.isActive ? '' : 'opacity-80',
                  )}
                  data-testid="needs-form-card"
                  data-form-id={form.id}
                >
                  <Thumbnail sections={form.sectionCount} fields={form.fieldCount} />
                  <div className="flex flex-1 flex-col gap-2.5 px-5 py-4.5">
                    <h2 id={titleId} className="m-0 text-lg font-bold leading-snug">
                      <a href={builder(form.id)} className="text-text no-underline hover:underline">
                        {name}
                      </a>
                    </h2>
                    {form.isDefault || locked || !form.isActive ? (
                      <div className="flex flex-wrap gap-1.5">
                        {form.isDefault ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary-subtle px-2 py-0.5 text-[13px] font-medium text-primary-text">
                            <Icon name="star" className="size-3.5" />
                            {text('defaultBadge')}
                          </span>
                        ) : null}
                        {locked ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning-subtle px-2 py-0.5 text-[13px] font-medium text-warning">
                            <Icon name="lock" className="size-3.5" />
                            {text('lockedBadge')}
                          </span>
                        ) : null}
                        {!form.isActive ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-hover px-2 py-0.5 text-[13px] font-medium text-text-muted">
                            <Icon name="power" className="size-3.5" />
                            {text('inactiveBadge')}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="m-0 text-sm text-text-muted" data-testid="needs-form-stats">
                      {text('statsCount', {
                        sections: form.sectionCount,
                        fields: form.fieldCount,
                      })}
                    </p>
                    {locked ? (
                      <p className="m-0 flex items-start gap-2 text-sm text-text-muted">
                        <Icon name="info" className="mt-0.5 size-4" />
                        <span>{text('lockedHint')}</span>
                      </p>
                    ) : null}
                    <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                      <a
                        href={builder(form.id)}
                        aria-label={`${editable ? text('edit') : text('view')}: ${name}`}
                        className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                        data-testid="needs-form-edit"
                      >
                        <Icon name={editable ? 'pencil' : 'eye'} />
                        {editable ? text('edit') : text('view')}
                      </a>
                      {canManage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className={MENU_TRIGGER}
                            aria-label={text('moreActions', { name })}
                            disabled={pending}
                            data-testid="needs-form-menu"
                          >
                            <Icon name="more" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onSelect={() => {
                                open({ kind: 'rename', form });
                              }}
                              data-testid="needs-form-rename"
                            >
                              <Icon name="pencil" />
                              {text('rename')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                open({ kind: 'duplicate', form });
                              }}
                              data-testid="needs-form-duplicate"
                            >
                              <Icon name="copy" />
                              {text('duplicate')}
                            </DropdownMenuItem>
                            {!form.isDefault ? (
                              <>
                                <DropdownMenuItem
                                  disabled={!form.isActive}
                                  onSelect={() => {
                                    run(
                                      () => api.setDefault(form.id),
                                      text('defaultSet'),
                                      () => undefined,
                                    );
                                  }}
                                  data-testid="needs-form-set-default"
                                >
                                  <Icon name="star" />
                                  {text('setDefault')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    switchActive(form);
                                  }}
                                  data-testid="needs-form-toggle-active"
                                >
                                  <Icon name="power" />
                                  {form.isActive ? text('deactivate') : text('activate')}
                                </DropdownMenuItem>
                                {!locked ? (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      tone="danger"
                                      onSelect={() => {
                                        setDeleting(form);
                                      }}
                                      data-testid="needs-form-delete"
                                    >
                                      <Icon name="trash" />
                                      {text('delete')}
                                    </DropdownMenuItem>
                                  </>
                                ) : null}
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
          {canManage && forms.length === 1 ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  open({ kind: 'create' });
                }}
                className="flex h-full min-h-60 w-full flex-col items-center justify-center gap-3 rounded-[22px] border-[1.5px] border-dashed border-border-strong font-semibold text-primary-text hover:bg-primary-subtle"
              >
                <span
                  aria-hidden="true"
                  className="grid size-14 place-items-center rounded-[18px] bg-primary-subtle"
                >
                  <Icon name="plus" className="size-6" />
                </span>
                {text('create')}
              </button>
            </li>
          ) : null}
        </ul>
      )}

      <Dialog
        open={dialog !== null}
        onClose={() => {
          if (!pending) setDialog(null);
        }}
        title={dialogTitle}
        description={dialogDesc}
        closeLabel={text('close')}
        size={dialog?.kind === 'create' ? 'lg' : 'md'}
        data-testid="needs-form-dialog"
      >
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          {message ? (
            <Alert tone="danger" data-testid="needs-form-dialog-error">
              {message}
            </Alert>
          ) : null}
          <TextField
            id="needs-form-name-en"
            label={text('nameEn')}
            marker={text('markerRequired')}
            dir="ltr"
            value={nameEn}
            maxLength={120}
            required
            error={fieldErrors.nameEn}
            onChange={(e) => {
              setNameEn(e.target.value);
            }}
          />
          <TextField
            id="needs-form-name-ar"
            label={text('nameAr')}
            marker={text('markerRequired')}
            dir="rtl"
            lang="ar"
            value={nameAr}
            maxLength={120}
            required
            error={fieldErrors.nameAr}
            onChange={(e) => {
              setNameAr(e.target.value);
            }}
          />
          {dialog?.kind === 'create' && forms.length > 0 ? (
            <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="mb-2 p-0 text-sm font-semibold">{text('startFrom')}</legend>
              <ChoiceCard
                id="needs-form-start-blank"
                name="needs-form-start"
                value="blank"
                checked={startFrom === 'blank'}
                onChange={() => {
                  setStartFrom('blank');
                }}
                title={text('startBlank')}
                data-testid="needs-form-start-blank"
              />
              <ChoiceCard
                id="needs-form-start-copy"
                name="needs-form-start"
                value="copy"
                checked={startFrom === 'copy'}
                onChange={() => {
                  setStartFrom('copy');
                }}
                title={text('startCopy', { name: copyForm ? nameOf(copyForm) : '' })}
                data-testid="needs-form-start-copy"
              >
                <SelectField
                  id="needs-form-copy-of"
                  label={text('startFrom')}
                  value={copyOf}
                  onChange={(e) => {
                    setCopyOf(e.target.value);
                  }}
                >
                  {forms.map((form) => (
                    <option key={form.id} value={form.id}>
                      {nameOf(form)}
                    </option>
                  ))}
                </SelectField>
              </ChoiceCard>
            </fieldset>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              type="button"
              disabled={pending}
              onClick={() => {
                setDialog(null);
              }}
            >
              {text('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={pending}
              busy={pending}
              data-testid="needs-form-dialog-submit"
            >
              {pending ? text('saving') : submitLabel}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onClose={() => {
          if (!pending) setDeleting(null);
        }}
        title={deleting ? text('deleteTitle', { name: nameOf(deleting) }) : ''}
        description={text('deleteDesc')}
        closeLabel={text('close')}
        size="sm"
        tone="danger"
        data-testid="needs-form-delete-dialog"
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
                if (target) {
                  run(
                    () => api.remove(target.id),
                    text('deleted'),
                    () => {
                      setDeleting(null);
                    },
                  );
                }
              }}
              data-testid="needs-form-delete-confirm"
            >
              {text('deleteConfirm')}
            </Button>
          </>
        }
      />
    </>
  );
}
