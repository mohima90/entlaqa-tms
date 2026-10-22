'use client';
import type { AppError } from '@jadarat/platform-core';
import { Alert, Button, Dialog, Icon, SidePanel, TextField, initialsOf } from '@jadarat/ui';
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
  /** «إغلاق» / "Close" — the label of the close button of the panel and the dialog. */
  readonly closeLabel: string;
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
  // A language's names all or nothing (the form's other name field of that language is filled).
  if (field.startsWith('admin') && field !== 'adminEmail')
    return text(code === 'CUSTOM' ? 'create.errors.adminNamePair' : 'create.errors.adminName');
  return text(`create.errors.${field}`);
}

function formatExpiry(locale: 'ar' | 'en', date: Date | string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
  }).format(new Date(date));
}

/** What the success view of the create panel recaps. */
interface CreatedOrganization {
  readonly code: InviteCodeValue;
  readonly name: string;
  readonly slug: string;
  readonly adminEmail: string;
}

/**
 * «إنشاء منظمة» / Create organization in a side panel (redesign package 5, PO 21 Oct 2026 — the list stays
 * in view; Kawadir ATS uses a dialog): short name, names, the Organization Admin's e-mail and optional
 * names, the invitation language (English by default). Created → the success view replaces the form in the
 * same panel: the organization, the code in large type, Copy code / Copy invite link, Done (no e-mail is
 * sent). Same checks, action and audit as before (FR-ADM-17).
 */
export function CreateOrganization(props: Shared) {
  const text = (key: string) => props.texts[key] ?? key;
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field | 'locale' | 'form', string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<CreatedOrganization | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
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
        setResult({
          code: {
            inviteCode: answer.value.inviteCode,
            locale: answer.value.locale,
            inviteLink: answer.value.inviteLink,
          },
          name:
            props.locale === 'en' && input.nameEn.trim() !== ''
              ? input.nameEn.trim()
              : input.nameAr.trim(),
          slug: input.slug,
          adminEmail: input.adminEmail.trim(),
        });
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
      disabled={pending}
      error={errors[name]}
      hint={name === 'slug' ? text('create.slugHint') : undefined}
      data-testid={`create-org-${name}`}
    />
  );

  const close = () => {
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setErrors({});
          setFailure(null);
          setResult(null);
          setOpen(true);
        }}
        data-testid="create-organization"
      >
        <Icon name="plus" />
        {text('create.open')}
      </Button>
      <SidePanel
        open={open}
        onClose={() => {
          setOpen(false);
          // The new organization joins the list.
          if (result) router.refresh();
        }}
        canClose={() => !pending}
        size="lg"
        title={text('create.title')}
        description={result ? undefined : text('create.intro')}
        closeLabel={props.closeLabel}
        data-testid="create-organization-panel"
        footer={
          result ? (
            <Button className="ms-auto" onClick={close} data-testid="organization-created-done">
              {text('created.done')}
            </Button>
          ) : (
            <div className="ms-auto flex flex-wrap gap-2.5">
              <Button variant="secondary" disabled={pending} onClick={close}>
                {text('create.cancel')}
              </Button>
              <Button
                type="submit"
                form={`${formId}-form`}
                busy={pending}
                disabled={pending}
                data-testid="create-organization-submit"
              >
                {pending ? text('create.submitting') : text('create.submit')}
              </Button>
            </div>
          )
        }
      >
        {result ? (
          <div data-testid="organization-created-dialog" className="flex flex-col gap-5">
            <div className="flex flex-col items-start gap-3">
              <span
                aria-hidden="true"
                className="grid size-14 place-items-center rounded-[18px] bg-success-subtle text-success"
              >
                <Icon name="success" className="size-7" />
              </span>
              <h3 className="m-0 text-2xl font-bold">{text('created.title')}</h3>
              <p className="m-0 text-text-muted">{text('created.text')}</p>
            </div>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14.5px]">
              <dt className="text-text-muted">{text('table.name')}</dt>
              <dd className="m-0 font-semibold">{result.name}</dd>
              <dt className="text-text-muted">{text('table.shortName')}</dt>
              <dd className="m-0 font-semibold">
                <code dir="ltr" className="font-mono">
                  {result.slug}
                </code>
              </dd>
              <dt className="text-text-muted">{text('create.adminSection')}</dt>
              <dd className="m-0 font-semibold [overflow-wrap:anywhere]">
                <bdi dir="ltr">{result.adminEmail}</bdi>
              </dd>
            </dl>
            <InviteCodeCopy value={result.code} texts={props.copyTexts} layout="panel" />
          </div>
        ) : (
          <form id={`${formId}-form`} noValidate onSubmit={submit} className="flex flex-col gap-4">
            {field('slug', { required: true, dir: 'ltr' })}
            <div className="grid gap-4 md:grid-cols-2">
              {field('nameAr', { required: true, dir: 'rtl' })}
              {field('nameEn', { dir: 'ltr' })}
            </div>
            <fieldset className="m-0 flex flex-col gap-4 rounded-lg border border-border p-4">
              <legend className="px-1 font-semibold">{text('create.adminSection')}</legend>
              {field('adminEmail', { required: true, type: 'email', dir: 'ltr' })}
              <p className="m-0 text-sm text-text-muted">{text('create.adminNamesHint')}</p>
              <div className="grid gap-4 md:grid-cols-2">
                {/* English first: a new organization's default language (PO 14 and 17 Oct 2026). */}
                {field('adminFirstNameEn', { dir: 'ltr' })}
                {field('adminFamilyNameEn', { dir: 'ltr' })}
                {field('adminFirstNameAr', { dir: 'rtl' })}
                {field('adminFamilyNameAr', { dir: 'rtl' })}
              </div>
              <SelectField
                id={`${formId}-locale`}
                name="locale"
                label={text('create.locale')}
                defaultValue="en"
                disabled={pending}
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
          </form>
        )}
      </SidePanel>
    </>
  );
}

/**
 * Row action while the Organization Admin has not joined: «رابط مدير المنظمة» opens the invitation in a
 * dialog (redesign package 5: the organization as a chip, the code box, «Valid until …») — its code fetched
 * when asked, an audited read — with Copy code / Copy invite link, and «رمز جديد» / New code. When the
 * invitation's issuer is no longer a Super Admin (`issuer_revoked`, review M1) its link no longer works:
 * the dialog says it needs a new code, which a new invitation issued by this Super Admin carries. One live
 * region stays mounted (loading, a new code issued); refusals are an alert outside it (L9).
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
  const [isOpen, setIsOpen] = useState(false);
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
    setIsOpen(true);
    // A revoked issuer's code no longer works: nothing to read — a new code is the way on.
    if (needsNewCode) return;
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
      <Dialog
        open={isOpen}
        onClose={() => {
          setIsOpen(false);
          if (changed.current) {
            changed.current = false;
            router.refresh();
          }
        }}
        title={text('invite.title')}
        description={text('invite.text')}
        closeLabel={props.closeLabel}
        data-testid="org-admin-invite-dialog"
        footer={
          <>
            <Button
              type="button"
              variant={needsNewCode ? 'primary' : 'secondary'}
              disabled={pending || (!invite && !needsNewCode)}
              busy={pending && (invite !== null || needsNewCode)}
              onClick={reissue}
              data-testid="org-admin-new-code"
            >
              <Icon name="repeat" />
              {pending && (invite || needsNewCode)
                ? text('invite.issuing')
                : text('invite.newCode')}
            </Button>
            <Button
              type="button"
              variant={needsNewCode ? 'secondary' : 'primary'}
              onClick={() => {
                setIsOpen(false);
              }}
            >
              {text('invite.close')}
            </Button>
          </>
        }
      >
        <p className="m-0 flex items-center gap-2.5 font-semibold">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-primary-subtle text-sm font-bold text-primary-text"
          >
            {initialsOf(props.organizationName)}
          </span>
          {props.organizationName}
        </p>
        {invite ? (
          <div className="flex flex-col gap-3">
            <InviteCodeCopy value={invite} texts={props.copyTexts} layout="panel" />
            <p
              className="m-0 flex items-center gap-2 text-sm text-text-muted"
              data-testid="org-admin-invite-expiry"
            >
              <Icon name="clock" className="size-4 shrink-0" />
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
          className="m-0 min-h-5 text-sm"
          data-testid="org-admin-invite-message"
        >
          {status}
        </p>
        {needsNewCode ? <Alert tone="warning">{text('invite.needsNewCode')}</Alert> : null}
        {failure ? (
          <Alert tone="danger" data-testid="org-admin-invite-error">
            {failure}
          </Alert>
        ) : null}
      </Dialog>
    </>
  );
}
