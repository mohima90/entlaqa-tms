'use client';
import type { AppError } from '@jadarat/platform-core';
import { type NeedsFormSummary, localized } from '@jadarat/tms/needs-forms';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Icon,
  PageHeader,
  TextField,
  buttonClasses,
  toast,
} from '@jadarat/ui';
import { type SyntheticEvent, useMemo, useState, useTransition } from 'react';
import { previewSummaries } from '../../lib/needs-forms-preview';
import type { LibraryResult } from '../../lib/needs-forms-api';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
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

/**
 * Planning → Needs forms (T-M3-10; Kawadir's application-forms library): one card per form with its
 * badges (Default, Locked, Off), sections and fields, and Edit · Rename · Duplicate · Set as default ·
 * Switch on/off · Delete for the L&D Manager (view only for the Training Coordinator). The default form
 * cannot be switched off or deleted; a locked form (used by a launched cycle) cannot be deleted.
 */
export function NeedsFormsLibrary(props: NeedsFormsLibraryProps) {
  const { locale, canManage } = props;
  const text = textsOf(props.texts, locale);
  const api = useNeedsFormsApi(props.mode);
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOf = (form: NeedsFormSummary) => localized(form.name, locale);

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
    inDialog = false,
  ) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        failed(result.error, inDialog);
        return;
      }
      setForms(result.value.forms);
      close();
      toast.success(done);
    });
  }

  function open(next: Exclude<DialogState, null>) {
    setFieldErrors({});
    setMessage(null);
    if (next.kind === 'create') {
      setNameEn('');
      setNameAr('');
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
    if (dialog.kind === 'create') run(() => api.create(names), text('created'), close, true);
    else if (dialog.kind === 'duplicate') {
      run(() => api.duplicate(dialog.form.id, names), text('duplicated'), close, true);
    } else
      run(
        () => api.rename(dialog.form.id, dialog.form.version, names),
        text('renamed'),
        close,
        true,
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

  return (
    <>
      <PageHeader
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
          data-testid="needs-forms-list"
        >
          {forms.map((form) => {
            const name = nameOf(form);
            const titleId = `needs-form-${form.id}`;
            const locked = form.lockedAt !== null;
            return (
              <li key={form.id}>
                <section
                  aria-labelledby={titleId}
                  className={`flex h-full flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-1 ${form.isActive ? '' : 'opacity-75'}`}
                  data-testid="needs-form-card"
                  data-form-id={form.id}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon name="form" className="size-5 text-primary-text" />
                      <h2 id={titleId} className="m-0 truncate text-base font-semibold">
                        {name}
                      </h2>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      {form.isDefault ? <Badge tone="info">{text('defaultBadge')}</Badge> : null}
                      {locked ? <Badge tone="warning">{text('lockedBadge')}</Badge> : null}
                      {!form.isActive ? (
                        <Badge tone="neutral">{text('inactiveBadge')}</Badge>
                      ) : null}
                    </div>
                  </div>
                  <p className="m-0 text-sm text-text-muted" data-testid="needs-form-stats">
                    {text('stats', { sections: form.sectionCount, fields: form.fieldCount })}
                  </p>
                  {locked ? (
                    <p className="m-0 text-sm text-text-muted">{text('lockedHint')}</p>
                  ) : null}
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <a
                      href={`${props.builderHref}/${form.id}`}
                      className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                      data-testid="needs-form-edit"
                    >
                      <Icon name={canManage && !locked ? 'pencil' : 'eye'} />
                      {canManage && !locked ? text('edit') : text('view')}
                    </a>
                    {canManage ? (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            open({ kind: 'rename', form });
                          }}
                          data-testid="needs-form-rename"
                        >
                          <Icon name="pencil" />
                          {text('rename')}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            open({ kind: 'duplicate', form });
                          }}
                          data-testid="needs-form-duplicate"
                        >
                          <Icon name="copy" />
                          {text('duplicate')}
                        </Button>
                        {!form.isDefault ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pending || !form.isActive}
                              onClick={() => {
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
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => {
                                run(
                                  () => api.setActive(form.id, !form.isActive),
                                  form.isActive ? text('deactivated') : text('activated'),
                                  () => undefined,
                                );
                              }}
                              data-testid="needs-form-toggle-active"
                            >
                              <Icon name="power" />
                              {form.isActive ? text('deactivate') : text('activate')}
                            </Button>
                            {!locked ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-danger"
                                disabled={pending}
                                onClick={() => {
                                  setDeleting(form);
                                }}
                                data-testid="needs-form-delete"
                              >
                                <Icon name="trash" />
                                {text('delete')}
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </section>
              </li>
            );
          })}
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
            <Button type="submit" disabled={pending} data-testid="needs-form-dialog-submit">
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
