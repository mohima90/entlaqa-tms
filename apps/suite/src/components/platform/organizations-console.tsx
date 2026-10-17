'use client';
import type { AppError } from '@jadarat/platform-core';
import { Alert, Button, TextField } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useId, useRef, useState, useTransition } from 'react';
import {
  createOrganizationAction,
  reissueOrganizationAdminCodeAction,
  viewOrganizationAdminCodeAction,
} from '../../auth/platform-console';
import { isOrganizationSlug } from '../../lib/organization-slug';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';
import { SelectField } from '../select-field';
import {
  InviteCodeCopy,
  type InviteCodeValue,
  type InviteCopyTexts,
} from '../users/invite-code-copy';

/** Raw texts of the `platform` namespace by dotted key (formatted on the server, filled here). */
export type PlatformTexts = Readonly<Record<string, string>>;

interface Shared {
  readonly locale: 'ar' | 'en';
  readonly texts: PlatformTexts;
  readonly copyTexts: InviteCopyTexts;
  readonly errors: ErrorTexts;
}

const FIELDS = [
  'slug',
  'nameAr',
  'nameEn',
  'adminEmail',
  'adminFirstNameAr',
  'adminFamilyNameAr',
  'adminFirstNameEn',
  'adminFamilyNameEn',
] as const;
type Field = (typeof FIELDS)[number];

/** The message of a field's error code (server or client). */
function fieldMessage(field: Field | 'locale' | 'form', code: string, text: (k: string) => string) {
  if (field === 'slug')
    return text(code === 'SLUG_TAKEN' ? 'create.errors.slugTaken' : 'create.errors.slug');
  // A Super Admin never invites their own account (review L7).
  if (field === 'adminEmail' && code === 'OWN_EMAIL') return text('create.errors.adminEmailOwn');
  if (field.startsWith('admin') && field !== 'adminEmail') return text('create.errors.adminName');
  return text(`create.errors.${field}`);
}

function formatExpiry(locale: 'ar' | 'en', date: Date | string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
  }).format(new Date(date));
}

/**
 * «إنشاء منظمة» / Create organization (Kawadir ATS's create dialog): short name, names, the Organization
 * Admin's e-mail and optional names, the invitation language (English by default) → the success dialog with
 * the code and the invite link to copy (no e-mail is sent).
 */
export function CreateOrganization(props: Shared) {
  const text = (key: string) => props.texts[key] ?? key;
  const router = useRouter();
  const formId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const created = useRef<HTMLDialogElement>(null);
  const [errors, setErrors] = useState<Partial<Record<Field | 'locale' | 'form', string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<InviteCodeValue | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => {
      const raw = data.get(name);
      return typeof raw === 'string' ? raw : '';
    };
    const input = {
      slug: value('slug').trim(),
      nameAr: value('nameAr'),
      nameEn: value('nameEn'),
      adminEmail: value('adminEmail'),
      adminFirstNameAr: value('adminFirstNameAr'),
      adminFamilyNameAr: value('adminFamilyNameAr'),
      adminFirstNameEn: value('adminFirstNameEn'),
      adminFamilyNameEn: value('adminFamilyNameEn'),
      locale: value('locale') === 'ar' ? ('ar' as const) : ('en' as const),
    };
    const local: Partial<Record<Field, string>> = {};
    if (!isOrganizationSlug(input.slug)) local.slug = text('create.errors.slug');
    if (input.nameAr.trim() === '') local.nameAr = text('create.errors.nameAr');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.adminEmail.trim()))
      local.adminEmail = text('create.errors.adminEmail');
    setFailure(null);
    setErrors(local);
    if (Object.keys(local).length > 0) {
      const first = FIELDS.find((f) => local[f]);
      if (first) document.getElementById(`${formId}-${first}`)?.focus();
      return;
    }
    startTransition(async () => {
      const answer = await createOrganizationAction(input);
      if (answer.ok) {
        dialog.current?.close();
        form.reset();
        setResult({
          inviteCode: answer.value.inviteCode,
          locale: answer.value.locale,
          inviteLink: answer.value.inviteLink,
        });
        created.current?.showModal();
        return;
      }
      showError(answer.error);
    });
  };

  const showError = (error: AppError) => {
    const codes = fieldErrorCodes(error);
    const fields = Object.keys(codes);
    if (error.code === 'VALIDATION_FAILED' && fields.length > 0) {
      const next: Partial<Record<Field | 'locale' | 'form', string>> = {};
      for (const field of fields) {
        const key =
          (FIELDS as readonly string[]).includes(field) || field === 'locale' ? field : 'form';
        next[key as Field] = fieldMessage(key as Field, codes[field] ?? '', text);
      }
      setErrors(next);
      if (next.form) setFailure(next.form);
      const first = FIELDS.find((f) => next[f]);
      if (first) document.getElementById(`${formId}-${first}`)?.focus();
      return;
    }
    setFailure(errorText(error, props.errors));
  };

  const field = (
    name: Field,
    options: { required?: boolean; type?: string; dir?: 'ltr' | 'rtl' } = {},
  ) => (
    <TextField
      id={`${formId}-${name}`}
      name={name}
      label={text(`create.${name}`)}
      marker={options.required ? text('create.required') : text('create.optional')}
      required={options.required}
      type={options.type ?? 'text'}
      dir={options.dir}
      autoComplete="off"
      error={errors[name]}
      hint={name === 'slug' ? text('create.slugHint') : undefined}
      data-testid={`create-org-${name}`}
    />
  );

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setErrors({});
          setFailure(null);
          dialog.current?.showModal();
        }}
        data-testid="create-organization"
      >
        {text('create.open')}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${formId}-title`}
        aria-describedby={`${formId}-intro`}
        className="w-full max-w-2xl rounded-lg border border-border bg-surface p-6 text-text shadow-lg backdrop:bg-black/40"
        data-testid="create-organization-dialog"
      >
        <h2 id={`${formId}-title`} className="m-0 mb-2 text-xl font-semibold">
          {text('create.title')}
        </h2>
        <p id={`${formId}-intro`} className="m-0 mb-4 text-text-muted">
          {text('create.intro')}
        </p>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          {field('slug', { required: true, dir: 'ltr' })}
          <div className="grid gap-4 md:grid-cols-2">
            {field('nameAr', { required: true, dir: 'rtl' })}
            {field('nameEn', { dir: 'ltr' })}
          </div>
          <fieldset className="m-0 flex flex-col gap-4 rounded-md border border-border p-4">
            <legend className="px-1 font-semibold">{text('create.adminSection')}</legend>
            {field('adminEmail', { required: true, type: 'email', dir: 'ltr' })}
            <p className="m-0 text-sm text-text-muted">{text('create.adminNamesHint')}</p>
            <div className="grid gap-4 md:grid-cols-2">
              {field('adminFirstNameAr', { dir: 'rtl' })}
              {field('adminFamilyNameAr', { dir: 'rtl' })}
              {field('adminFirstNameEn', { dir: 'ltr' })}
              {field('adminFamilyNameEn', { dir: 'ltr' })}
            </div>
            <SelectField
              id={`${formId}-locale`}
              name="locale"
              label={text('create.locale')}
              defaultValue="en"
              error={errors.locale}
              data-testid="create-org-locale"
            >
              <option value="en">{text('create.localeEn')}</option>
              <option value="ar">{text('create.localeAr')}</option>
            </SelectField>
          </fieldset>
          {failure ? (
            <Alert tone="danger" data-testid="create-organization-error">
              {failure}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending} data-testid="create-organization-submit">
              {pending ? text('create.submitting') : text('create.submit')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                dialog.current?.close();
              }}
            >
              {text('create.cancel')}
            </Button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={created}
        aria-labelledby={`${formId}-created`}
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 text-text shadow-lg backdrop:bg-black/40"
        data-testid="organization-created-dialog"
        onClose={() => {
          router.refresh();
        }}
      >
        <h2 id={`${formId}-created`} className="m-0 mb-2 text-xl font-semibold">
          {text('created.title')}
        </h2>
        <p className="m-0 mb-4 text-text-muted">{text('created.text')}</p>
        {result ? <InviteCodeCopy value={result} texts={props.copyTexts} layout="panel" /> : null}
        <div className="mt-4">
          <Button
            type="button"
            onClick={() => {
              created.current?.close();
            }}
            data-testid="organization-created-done"
          >
            {text('created.done')}
          </Button>
        </div>
      </dialog>
    </>
  );
}

/**
 * Row action while the Organization Admin has not joined: «رابط مدير المنظمة» opens the invitation (its code
 * fetched when asked — an audited read) with Copy code / Copy invite link, and «رمز جديد» / New code. When
 * the invitation's issuer is no longer a Super Admin (`issuer_revoked`, review M1) its link no longer
 * works: the dialog says it needs a new code, which a new invitation issued by this Super Admin carries.
 * One live region stays mounted (loading, a new code issued); refusals are an alert outside it (L9).
 */
export function OrganizationAdminInvite(
  props: Shared & {
    readonly tenantId: string;
    readonly organizationName: string;
    readonly adminState: 'pending' | 'expired' | 'issuer_revoked';
  },
) {
  const text = (key: string) => props.texts[key] ?? key;
  const router = useRouter();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [invite, setInvite] = useState<(InviteCodeValue & { expiresAt: Date | string }) | null>(
    null,
  );
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [needsNewCode, setNeedsNewCode] = useState(props.adminState === 'issuer_revoked');
  const [pending, startTransition] = useTransition();
  const changed = useRef(false);

  const show = (value: {
    inviteCode: string;
    locale: 'ar' | 'en';
    inviteLink: string | null;
    expiresAt: Date | string;
  }) => {
    setInvite({
      inviteCode: value.inviteCode,
      locale: value.locale,
      inviteLink: value.inviteLink,
      expiresAt: value.expiresAt,
    });
  };

  const open = () => {
    setInvite(null);
    setFailure(null);
    setStatus('');
    dialog.current?.showModal();
    // A revoked issuer's code no longer works: nothing to read — a new code is the way on.
    if (needsNewCode) {
      setStatus(text('invite.needsNewCode'));
      return;
    }
    setStatus(text('invite.loading'));
    startTransition(async () => {
      const answer = await viewOrganizationAdminCodeAction({ tenantId: props.tenantId });
      if (answer.ok) {
        show(answer.value);
        setStatus('');
      } else {
        setStatus('');
        setFailure(errorText(answer.error, props.errors));
      }
    });
  };

  const reissue = () => {
    setFailure(null);
    setStatus(text('invite.issuing'));
    startTransition(async () => {
      const answer = await reissueOrganizationAdminCodeAction({ tenantId: props.tenantId });
      if (answer.ok) {
        changed.current = true;
        setNeedsNewCode(false);
        show(answer.value);
        setStatus(text('invite.newCodeIssued'));
      } else {
        setStatus('');
        setFailure(errorText(answer.error, props.errors));
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={open}
        data-testid="org-admin-invite"
      >
        {text('invite.open')}
        <span className="sr-only">{` (${props.organizationName})`}</span>
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 text-text shadow-lg backdrop:bg-black/40"
        data-testid="org-admin-invite-dialog"
        onClose={() => {
          if (changed.current) {
            changed.current = false;
            router.refresh();
          }
        }}
      >
        <h2 id={`${id}-title`} className="m-0 mb-1 text-xl font-semibold">
          {text('invite.title')}
        </h2>
        <p className="m-0 mb-4 font-medium">{props.organizationName}</p>
        <p className="m-0 mb-4 text-text-muted">{text('invite.text')}</p>
        {invite ? (
          <div className="flex flex-col gap-2">
            <InviteCodeCopy value={invite} texts={props.copyTexts} layout="panel" />
            <p className="m-0 text-sm text-text-muted" data-testid="org-admin-invite-expiry">
              {text('invite.expires').replace(
                '{date}',
                formatExpiry(props.locale, invite.expiresAt),
              )}
            </p>
          </div>
        ) : null}
        {/* Always mounted: loading, "needs a new code" and "new code issued" are announced (L9). */}
        <p
          role="status"
          aria-live="polite"
          className="m-0 mt-3 min-h-5 text-sm"
          data-testid="org-admin-invite-message"
        >
          {status}
        </p>
        {failure ? (
          <Alert tone="danger" className="mt-3" data-testid="org-admin-invite-error">
            {failure}
          </Alert>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            type="button"
            variant={needsNewCode ? 'primary' : 'secondary'}
            disabled={pending || (!invite && !needsNewCode)}
            onClick={reissue}
            data-testid="org-admin-new-code"
          >
            {pending && (invite || needsNewCode) ? text('invite.issuing') : text('invite.newCode')}
          </Button>
          <Button
            type="button"
            variant={needsNewCode ? 'secondary' : 'primary'}
            onClick={() => {
              dialog.current?.close();
            }}
          >
            {text('invite.close')}
          </Button>
        </div>
      </dialog>
    </>
  );
}
