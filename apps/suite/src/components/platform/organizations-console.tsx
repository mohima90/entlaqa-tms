'use client';
import type { AppError } from '@jadarat/platform-core';
import { personDisplayName } from '@jadarat/platform-i18n/names';
import { Alert, Button, Dialog, Icon, TextField, initialsOf } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  createOrganizationAction,
  reissueOrganizationAdminCodeAction,
  viewOrganizationAdminCodeAction,
} from '../../auth/platform-console';
import { organizationNameField } from '../../lib/organization-name-field';
import { isOrganizationSlug } from '../../lib/organization-slug';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useFocusInvalid } from '../planning/use-focus-invalid';
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
  /** «إغلاق» / "Close" — the label of the ✕ of the popups (never a footer button's name). */
  readonly closeLabel: string;
}

const ADMIN_NAME_FIELDS = [
  'adminFirstNameAr',
  'adminFamilyNameAr',
  'adminFirstNameEn',
  'adminFamilyNameEn',
] as const;
const FIELDS = ['slug', 'nameAr', 'nameEn', 'adminEmail', ...ADMIN_NAME_FIELDS] as const;
type Field = (typeof FIELDS)[number];
type Language = 'ar' | 'en';
type Errors = Partial<Record<Field | 'locale', string>>;

const isAdminName = (field: string): boolean =>
  (ADMIN_NAME_FIELDS as readonly string[]).includes(field);

/** The message of a field's error code (server or client). */
function fieldMessage(
  field: Field | 'locale',
  code: string,
  language: Language,
  text: (k: string) => string,
) {
  if (field === 'slug')
    return text(code === 'SLUG_TAKEN' ? 'create.errors.slugTaken' : 'create.errors.slug');
  // A Super Admin never invites their own account (review L7).
  if (field === 'adminEmail' && code === 'OWN_EMAIL') return text('create.errors.adminEmailOwn');
  // The name in the organization's language is required; the other one only has its length to keep.
  if (field === 'nameAr' || field === 'nameEn')
    return text(
      field === organizationNameField(language)
        ? `create.errors.${field}`
        : 'create.errors.nameOther',
    );
  // A language's names all or nothing (the form's other name field of that language is filled).
  if (isAdminName(field))
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

/** What the success view of the create popup recaps. */
interface CreatedOrganization {
  readonly code: InviteCodeValue;
  readonly name: string;
  readonly slug: string;
  readonly adminEmail: string;
}

type Plans = readonly { readonly planId: string; readonly name: string }[];

/** The popup's form: the dialog's footer submits it. */
const CREATE_FORM_ID = 'create-organization-form';

/**
 * «إنشاء منظمة» / Create organization — one centred popup, 672 px (WP-UX-01 d, T-M3-21; forms standard rules
 * 8–9; PO 12 Nov 2026 — the Kawadir pattern; a side panel before): the organization's names, its language,
 * short name, the Organization Admin's e-mail, the plan and a 30-day trial (ticked). The name in the language
 * chosen is required (a red asterisk), the other language optional; the Organization Admin's names wait
 * behind «More». «Cancel», then «Create organization» at the end. Created → the same popup shows the
 * organization, the code in large type, Copy code / Copy invite link and «Done» (no e-mail is sent). Same
 * action, checks and audit as before (FR-ADM-17). Each opening starts with an empty form.
 */
export function CreateOrganization(props: Shared & { readonly plans?: Plans }) {
  const text = (key: string) => props.texts[key] ?? key;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreatedOrganization | null>(null);
  // Created: the recap takes the focus (the form and its button are gone), so it is read out.
  const created = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result) created.current?.focus();
  }, [result]);
  const close = () => {
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setResult(null);
          setOpening((n) => n + 1);
          setOpen(true);
        }}
        data-testid="create-organization"
      >
        <Icon name="plus" />
        {text('create.open')}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          // The new organization joins the list.
          if (result) router.refresh();
        }}
        canClose={() => !busy}
        size="rich"
        title={result ? text('created.title') : text('create.title')}
        description={result ? text('created.text') : text('create.intro')}
        closeLabel={props.closeLabel}
        data-testid="create-organization-panel"
        // «Cancel», then the primary button at the end — the dialog keeps them in view while it scrolls.
        footer={
          result ? (
            <Button onClick={close} data-testid="organization-created-done">
              {text('created.done')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" disabled={busy} onClick={close}>
                {text('create.cancel')}
              </Button>
              <Button
                type="submit"
                form={CREATE_FORM_ID}
                busy={busy}
                disabled={busy}
                data-testid="create-organization-submit"
              >
                {busy ? text('create.submitting') : text('create.submit')}
              </Button>
            </>
          )
        }
      >
        {result ? (
          <div
            ref={created}
            tabIndex={-1}
            data-testid="organization-created-dialog"
            className="flex flex-col gap-5 outline-none"
          >
            <div className="flex items-start gap-3.5">
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-[16px] bg-success-subtle text-success"
              >
                <Icon name="success" className="size-6" />
              </span>
              <dl className="m-0 grid min-w-0 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14.5px]">
                <dt className="text-text-muted">{text('table.name')}</dt>
                <dd className="m-0 font-semibold [overflow-wrap:anywhere]">{result.name}</dd>
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
            </div>
            <InviteCodeCopy value={result.code} texts={props.copyTexts} layout="panel" />
          </div>
        ) : open ? (
          <CreateOrganizationForm key={opening} {...props} onBusy={setBusy} onCreated={setResult} />
        ) : null}
      </Dialog>
    </>
  );
}

function CreateOrganizationForm(
  props: Shared & {
    readonly plans?: Plans;
    readonly onBusy: (busy: boolean) => void;
    readonly onCreated: (created: CreatedOrganization) => void;
  },
) {
  const text = (key: string) => props.texts[key] ?? key;
  const formId = useId();
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  // The organization's language — its default language (which name its forms require, the language of new
  // people) and its invitation's; the database sets both (20261113120300).
  const [language, setLanguage] = useState<Language>('en');
  // «More» (the Organization Admin's names) starts closed; a refused field inside opens it.
  const [more, setMore] = useState(false);
  const [pending, startTransition] = useTransition();
  // A refusal moves the focus to the first refused field once the fields are enabled again.
  const { form, focusInvalid } = useFocusInvalid(pending);
  const requiredName = organizationNameField(language);

  const refuse = (next: Errors) => {
    setErrors(next);
    if (Object.keys(next).some(isAdminName)) setMore(true);
    focusInvalid();
  };

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
      locale: language,
      // The plan it starts on and a 30-day trial (WP-ADM-06).
      planId: value('planId') === '' ? null : value('planId'),
      trial: data.get('trial') === 'on',
    };
    const local: Errors = {};
    if (input[requiredName].trim() === '')
      local[requiredName] = text(`create.errors.${requiredName}`);
    if (!isOrganizationSlug(input.slug)) local.slug = text('create.errors.slug');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.adminEmail.trim()))
      local.adminEmail = text('create.errors.adminEmail');
    setFailure(null);
    if (Object.keys(local).length > 0) {
      refuse(local);
      return;
    }
    setErrors({});
    props.onBusy(true);
    startTransition(async () => {
      try {
        const answer = await createOrganizationAction(input);
        if (answer.ok) {
          props.onCreated({
            code: {
              inviteCode: answer.value.inviteCode,
              locale: answer.value.locale,
              inviteLink: answer.value.inviteLink,
            },
            // The name in the page's language, else the one given.
            name: personDisplayName(props.locale, input.nameAr.trim(), input.nameEn.trim()),
            slug: input.slug,
            adminEmail: input.adminEmail.trim(),
          });
          return;
        }
        showError(answer.error);
      } finally {
        props.onBusy(false);
      }
    });
  };

  const showError = (error: AppError) => {
    const codes = fieldErrorCodes(error);
    const fields = Object.keys(codes);
    if (error.code === 'VALIDATION_FAILED' && fields.length > 0) {
      const next: Errors = {};
      let other = false;
      for (const field of fields) {
        if ((FIELDS as readonly string[]).includes(field) || field === 'locale') {
          next[field as Field] = fieldMessage(field as Field, codes[field] ?? '', language, text);
        } else other = true;
      }
      if (other) setFailure(text('create.errors.form'));
      refuse(next);
      return;
    }
    setFailure(errorText(error, props.errors));
  };

  const field = (
    name: Field,
    options: { required?: boolean; type?: string; lang?: Language } = {},
  ) => (
    <TextField
      key={name}
      id={`${formId}-${name}`}
      name={name}
      label={text(`create.${name}`)}
      marker={options.required ? text('create.required') : text('create.optional')}
      required={options.required}
      type={options.type ?? 'text'}
      dir={options.lang === 'ar' ? 'rtl' : 'ltr'}
      lang={options.lang}
      autoComplete="off"
      disabled={pending}
      error={errors[name]}
      hint={name === 'slug' ? text('create.slugHint') : undefined}
      data-testid={`create-org-${name}`}
    />
  );
  // A short natural pair: side by side from 600 px, one per row on a phone.
  const pair = 'grid grid-cols-1 items-start gap-4 md:grid-cols-2';
  // The organization's language first (English by default — PO 14 and 17 Oct 2026).
  const languages: readonly Language[] = language === 'ar' ? ['ar', 'en'] : ['en', 'ar'];
  const suffix = (l: Language) => (l === 'ar' ? 'Ar' : 'En');

  return (
    <form
      ref={form}
      id={CREATE_FORM_ID}
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4"
    >
      {failure ? (
        <Alert tone="danger" data-testid="create-organization-error">
          {failure}
        </Alert>
      ) : null}
      {/* The name in the language chosen below first and required; the other language optional. */}
      <div className={pair}>
        {languages.map((l) =>
          field(`name${suffix(l)}`, { required: `name${suffix(l)}` === requiredName, lang: l }),
        )}
      </div>
      <SelectField
        id={`${formId}-locale`}
        name="locale"
        label={text('create.locale')}
        value={language}
        onChange={(event) => {
          setLanguage(event.target.value === 'ar' ? 'ar' : 'en');
          // The required name moves with the language: an earlier «enter the name» no longer applies.
          setErrors(({ nameAr: _ar, nameEn: _en, ...rest }) => rest);
        }}
        disabled={pending}
        error={errors.locale}
        hint={text('create.localeHint')}
        data-testid="create-org-locale"
      >
        <option value="en">{text('create.localeEn')}</option>
        <option value="ar">{text('create.localeAr')}</option>
      </SelectField>
      {field('slug', { required: true })}
      {field('adminEmail', { required: true, type: 'email' })}
      {/* The plan and a 30-day trial (WP-ADM-06, business flow B1). */}
      <SelectField
        id={`${formId}-planId`}
        name="planId"
        label={text('create.plan')}
        defaultValue=""
        disabled={pending}
        data-testid="create-org-plan"
      >
        <option value="">{text('organizationPlan.noPlan')}</option>
        {(props.plans ?? []).map((plan) => (
          <option key={plan.planId} value={plan.planId}>
            {plan.name}
          </option>
        ))}
      </SelectField>
      <div className="flex items-start gap-3">
        <input
          id={`${formId}-trial`}
          type="checkbox"
          name="trial"
          defaultChecked
          disabled={pending}
          aria-describedby={`${formId}-trial-hint`}
          className="mt-0.5 size-5 shrink-0 accent-primary"
          data-testid="create-org-trial"
        />
        <span className="flex flex-col gap-0.5">
          <label htmlFor={`${formId}-trial`} className="cursor-pointer font-semibold">
            {text('create.trial')}
          </label>
          <span id={`${formId}-trial-hint`} className="text-sm text-text-muted">
            {text('create.trialHint')}
          </span>
        </span>
      </div>
      {/* Everything optional waits behind «More»: the Organization Admin's names. */}
      <button
        type="button"
        className="flex min-h-10 items-center gap-1.5 self-start rounded-full px-2 text-start text-sm font-semibold text-primary-text hover:bg-primary-subtle pointer-coarse:min-h-11"
        aria-expanded={more}
        aria-controls={`${formId}-more`}
        onClick={() => {
          setMore((current) => !current);
        }}
        data-testid="create-org-more"
      >
        <Icon name={more ? 'chevron-down' : 'chevron-end'} />
        <span>
          {text('create.more')}
          <span className="font-normal text-text-muted">{` · ${text('create.moreSummary')}`}</span>
        </span>
      </button>
      <fieldset
        id={`${formId}-more`}
        className={more ? 'm-0 flex min-w-0 flex-col gap-4 border-0 p-0' : 'hidden'}
      >
        <legend className="sr-only">{text('create.moreSummary')}</legend>
        <p className="m-0 text-sm text-text-muted">{text('create.adminNamesHint')}</p>
        {languages.map((l) => (
          <div key={l} className={pair}>
            {field(`adminFirstName${suffix(l)}`, { lang: l })}
            {field(`adminFamilyName${suffix(l)}`, { lang: l })}
          </div>
        ))}
      </fieldset>
    </form>
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
