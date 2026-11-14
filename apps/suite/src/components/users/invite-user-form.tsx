'use client';
import { Alert, Badge, Button, Dialog, Icon, TextField, buttonClasses, toast } from '@jadarat/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from 'react';
import { invitePrivilegedUserAction, inviteUserAction } from '../../actions/invitations';
import { type ManagerChoice, managersFor } from '../../lib/edit-user-form';
import { returnFocusTo } from '../../lib/focus-return';
import { displayInviteCode } from '../../lib/invite-code';
import { createdName, inviteFieldError, keptBehindMore } from '../../lib/invite-form';
import { inviteLink } from '../../lib/invite-link';
import {
  type RoleOption,
  needsScopeUnit,
  readsHeadedDepartments,
  roleActionPath,
} from '../../lib/role-choice';
import { missingNameFields } from '@jadarat/platform-i18n';
import { fillText } from '../../lib/fill-text';
import {
  DEPARTMENT_HEAD_ROLE,
  type HeadUnitView,
  headUnitDefault,
  headUnitErrorKey,
  unitLabel,
} from '../../lib/head-unit';
import type { ScopeUnitChoice } from '../../lib/structure-view';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { fieldErrorCodes } from '../profile/field-errors';
import { SelectField } from '../select-field';
import type { UnitChoice } from './edit-user-form';
import type { InviteCodeValue, InviteCopyTexts } from './invite-code-copy';
import { DiscardDialog, type DiscardTexts } from './discard-dialog';
import { RoleSelect, type RoleSelectTexts } from './role-select';
import { HeadConfirmDialog, HeadUnitField, type HeadUnitTexts } from './head-unit-field';
import { ScopeUnitSelect, type ScopeUnitTexts } from './scope-unit-select';

export interface InviteUserFormProps {
  /**
   * The organization's default language for new people (T-M2-22): the invitation language preselected, and
   * the language whose first and family names are required and shown first (PO 17 Oct 2026).
   */
  readonly defaultLocale: 'ar' | 'en';
  readonly departments: readonly UnitChoice[];
  readonly branches: readonly UnitChoice[];
  readonly managers: readonly ManagerChoice[];
  /** The roles (standard, then custom), each with whether this member may give it (EP-ROLES). */
  readonly roles: readonly RoleOption[];
  readonly roleTexts: RoleSelectTexts;
  /** The unit picker (tree order) for a custom role limited to «A department» (EP-ORG, T-M3-09). */
  readonly scopeUnits: readonly ScopeUnitChoice[];
  readonly unitTexts: ScopeUnitTexts;
  /** «Head of which department?» for the Department Head role (WP-FIX-03). */
  readonly headUnits: HeadUnitView;
  readonly headTexts: HeadUnitTexts;
  /** Texts by key (translated on the server). */
  readonly labels: Readonly<Record<string, string>>;
  readonly fieldTexts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** The list behind the popup (closing returns to it) and its «Pending invites» view. */
  readonly usersHref: string;
  readonly invitedHref: string;
  readonly rolesHref: string;
  /** The code and link of the success view (Kawadir). */
  readonly copyTexts: InviteCopyTexts;
  /** «Discard your changes?» (namespace `users`) before the popup closes with something typed. */
  readonly discardTexts: DiscardTexts;
  /** The page's language: the success view names the invitee in it (English name when given). */
  readonly uiLocale: 'ar' | 'en';
}

/** What the invite actions take (the form's fields as typed). */
type InviteInput = Parameters<typeof inviteUserAction>[0];

/** The invitation just created: its code to copy (Kawadir, with its language and link) and the name. */
interface Created {
  readonly value: InviteCodeValue;
  readonly name: string;
}

/** A code or link to copy, in a dashed box with its button (the browser's refusal selects it instead). */
function CopyBox({
  label,
  value,
  button,
  copied,
  failed,
  large,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly button: string;
  readonly copied: string;
  readonly failed: string;
  readonly large?: boolean;
  readonly testId: string;
}) {
  const ref = useRef<HTMLElement>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border-[1.5px] border-dashed border-border-strong bg-surface-sunken px-4 py-3">
        <code
          ref={ref}
          dir="ltr"
          className={`min-w-0 flex-1 font-mono [overflow-wrap:anywhere] ${large ? 'text-2xl font-semibold tracking-[0.15em]' : 'text-sm'}`}
          data-testid={testId}
        >
          {value}
        </code>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(
              () => toast.success(copied),
              () => {
                toast.error(failed, { duration: 6000 });
                const node = ref.current;
                const selection = window.getSelection();
                if (node && selection) {
                  const range = document.createRange();
                  range.selectNodeContents(node);
                  selection.removeAllRanges();
                  selection.addRange(range);
                }
              },
            );
          }}
          data-testid={`${testId}-copy`}
        >
          <Icon name="copy" className="size-4" />
          {button}
        </Button>
      </div>
    </div>
  );
}

/** The fields behind «More options», in the order they appear, with the element that shows each one's refusal. */
const MORE_FIELD_IDS = {
  departmentId: 'invite-department',
  branchId: 'invite-branch',
  managerPersonId: 'invite-manager',
  employeeNumber: 'invite-employeeNumber',
} as const;

/**
 * Invite a member in one centred popup over Team members (672 px; forms standard rule 9 — the Kawadir
 * pattern, PO 12 Nov 2026; before: a side panel. T-M2-07, FR-IAM-03, BR-IAM-1): the few fields needed now —
 * work e-mail, the first and family names in the organization's default language, one role (EP-ROLES:
 * privileged roles listed but unavailable unless Organization Admin; a department-limited role asks its
 * unit, the Department Head role its department) and the invitation language. Everything optional waits
 * behind «More options» in the same popup: department, branch, direct manager, employee number and the
 * names in the other language. Sent → the same popup shows the code and the link to copy (Kawadir; no
 * e-mail needed), the list behind updates its counts, and «Invite another user» keeps the unit, branch,
 * manager, role and language. Same validation, permissions and actions as before; its own address
 * (`/users/invite`) still opens it.
 */
export function InviteUserPanel(props: InviteUserFormProps) {
  const { labels, fieldTexts, roles } = props;
  const text = (key: string) => labels[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const nameLanguage = props.defaultLocale;
  const otherLanguage = nameLanguage === 'ar' ? 'en' : 'ar';
  const otherSuffix = otherLanguage === 'ar' ? 'Ar' : 'En';
  // «More options» starts closed; a refused field inside opens it.
  const [more, setMore] = useState(false);
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [allManagers, setAllManagers] = useState(false);
  const [role, setRole] = useState('');
  const [scopeUnitId, setScopeUnitId] = useState('');
  const withUnit = needsScopeUnit(roles, role);
  // The department a new Department Head heads (WP-FIX-03): their own — the Department of this form —
  // unless another one is picked (PO, 12 Nov 2026); asked only when no Department is chosen.
  const [pickedHeadUnitId, setHeadUnitId] = useState('');
  const [askReplace, setAskReplace] = useState<InviteInput | null>(null);
  const picksHead = props.headUnits.canPick && role === DEPARTMENT_HEAD_ROLE;
  const ownUnitId = departmentId === '' ? null : departmentId;
  const headUnitId = headUnitDefault({
    picked: pickedHeadUnitId,
    ownUnitId,
    headsSomething: false,
    units: props.scopeUnits,
  });
  const headText = (key: string, values: Record<string, string> = {}) =>
    fillText(props.headTexts[key] ?? key, values, props.uiLocale);
  const headUnitName = unitLabel(props.scopeUnits.find((u) => u.id === headUnitId)?.label ?? '');
  const replacedHead = picksHead
    ? (props.headUnits.heads.find((h) => h.unitId === headUnitId) ?? null)
    : null;
  const [invitationLocale, setInvitationLocale] = useState<'ar' | 'en'>(props.defaultLocale);
  const [created, setCreated] = useState<Created | null>(null);
  const [kept, setKept] = useState(false);
  const [formKey, setFormKey] = useState(0);
  // Something typed or chosen in the form since it opened (or since «Invite another»).
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  const lockedSome = roles.some((r) => !r.assignable);
  const managers = managersFor(props.managers, departmentId, allManagers, managerId);
  const successHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (created) successHeading.current?.focus();
  }, [created]);

  /** Escape, ✕, the backdrop and Cancel: never while sending; with unsaved changes, ask first. */
  const canClose = () => {
    if (pending) return false;
    if (created || !dirty) return true;
    setAsking(true);
    return false;
  };

  const close = (href = props.usersHref) => {
    returnFocusTo('invite-user-link');
    router.push(href, { scroll: false });
  };

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const input = {
      email: field('email'),
      // The other language's names sit behind «More options» (empty unless typed there).
      firstNameAr: field('firstNameAr'),
      familyNameAr: field('familyNameAr'),
      firstNameEn: field('firstNameEn'),
      familyNameEn: field('familyNameEn'),
      departmentId,
      branchId,
      managerPersonId: managerId,
      employeeNumber: field('employeeNumber'),
      // Validated on the server (an empty choice comes back as a field error).
      role,
      // A unit goes only with a department-limited custom role (EP-ORG); the server checks it.
      scopeUnitId: withUnit ? scopeUnitId : '',
      // The department a new Department Head heads (WP-FIX-03); the server checks it.
      headUnitId: picksHead ? headUnitId : '',
      replaceHead: false,
      locale: invitationLocale,
    };
    setMessage(null);
    setFieldErrors({});
    if (picksHead && headUnitId === '') {
      setFieldErrors({ headUnitId: headText('required') });
      return;
    }
    // The department has a head: ask before replacing (a small popup).
    if (replacedHead) {
      setAskReplace(input);
      return;
    }
    send(input);
  }

  function send(input: InviteInput) {
    const action =
      role !== '' && roleActionPath(roles, role) === 'privileged'
        ? invitePrivilegedUserAction
        : inviteUserAction;
    startTransition(async () => {
      const result = await action(input);
      setAskReplace(null);
      if (result.ok) {
        // Kawadir: the code and the link right away (no e-mail needed); the list keeps them too.
        setDirty(false);
        // A Department Head invited by a member who does not see the structure (a custom role without the
        // Organization pages): say who picks the department (WP-FIX-03).
        if (input.role === DEPARTMENT_HEAD_ROLE && !props.headUnits.canPick) {
          toast.info(
            headText('invitedNoUnit', {
              name: createdName(props.uiLocale, {
                ar: [input.firstNameAr, input.familyNameAr],
                en: [input.firstNameEn, input.familyNameEn],
              }),
            }),
          );
        }
        setCreated({
          value: {
            inviteCode: result.value.inviteCode,
            locale: result.value.locale,
            inviteLink: result.value.inviteLink,
          },
          name: createdName(props.uiLocale, {
            ar: [input.firstNameAr, input.familyNameAr],
            en: [input.firstNameEn, input.familyNameEn],
          }),
        });
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      if (result.error.code === 'VALIDATION_FAILED') {
        const errors: Record<string, string> = {};
        for (const [path, code] of Object.entries(fieldErrorCodes(result.error))) {
          if (path === 'headUnitId') {
            errors.headUnitId = headText(headUnitErrorKey(code));
            // The heads changed since the form was opened: load them again.
            router.refresh();
            continue;
          }
          const { field: name, key } = inviteFieldError(path, code);
          errors[name] ??= fieldTexts[key] ?? fieldTexts.name ?? '';
        }
        // The names rule runs in the action after the other fields' checks: a form sent with another
        // mistake hears about its missing names in the same answer, not on the next try (the action
        // still decides).
        for (const name of missingNameFields(nameLanguage, input)) {
          errors[name] ??= fieldTexts.required ?? '';
        }
        // A refused field under «More options» is shown, not hidden: open it and move to the field.
        const hidden =
          Object.entries(MORE_FIELD_IDS).find(([name]) => errors[name] !== undefined)?.[1] ??
          (errors[`firstName${otherSuffix}`] !== undefined
            ? `invite-firstName${otherSuffix}`
            : errors[`familyName${otherSuffix}`] !== undefined
              ? `invite-familyName${otherSuffix}`
              : null);
        if (hidden !== null) {
          setMore(true);
          // Only when nothing in view was refused too: the first refused field in view keeps the focus.
          if (
            Object.keys(errors).every(
              (name) => name in MORE_FIELD_IDS || name.endsWith(otherSuffix),
            )
          ) {
            requestAnimationFrame(() => document.getElementById(hidden)?.focus());
          }
        }
        setFieldErrors(errors);
      }
      setMessage(errorText(result.error, props.errors));
    });
  }

  /**
   * First and family name of one language side by side on a desktop (a natural pair), one per row on
   * phones — each labelled with its language («First name in English» / «الاسم الأول بالعربية»: the two
   * sets look alike, WCAG 2.4.6); the default language's are required.
   */
  const nameFields = (language: 'ar' | 'en', required: boolean) => {
    const suffix = language === 'ar' ? 'Ar' : 'En';
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(['firstName', 'familyName'] as const).map((part) => (
          <TextField
            key={`${part}${suffix}`}
            id={`invite-${part}${suffix}`}
            name={`${part}${suffix}`}
            label={text(`${part}${suffix}`)}
            marker={required ? text('required') : text('optional')}
            required={required}
            maxLength={60}
            dir={language === 'ar' ? 'rtl' : 'ltr'}
            lang={language}
            autoComplete="off"
            error={fieldErrors[`${part}${suffix}`]}
            disabled={pending}
          />
        ))}
      </div>
    );
  };

  const value = created?.value;
  const link = value
    ? (value.inviteLink ?? inviteLink(window.location.origin, value.locale, value.inviteCode))
    : '';

  return (
    <>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          close();
        }}
        canClose={canClose}
        size="rich"
        title={text('title')}
        description={created ? undefined : text('intro')}
        closeLabel={text('close')}
        data-testid="invite-panel"
        footer={
          created ? (
            <>
              <Link
                href={props.invitedHref}
                onClick={(event) => {
                  event.preventDefault();
                  close(props.invitedHref);
                }}
                className={`${buttonClasses({ variant: 'ghost', size: 'md' })} sm:me-auto`}
                data-testid="invite-to-list"
              >
                {text('created.toList')}
              </Link>
              <Button
                variant="secondary"
                onClick={() => {
                  setCreated(null);
                  setDirty(false);
                  // «More» stays open while something behind it is kept (a department, a branch or a
                  // manager): a kept choice is never out of sight in the next invitation.
                  setMore(keptBehindMore({ departmentId, branchId, managerId }));
                  setFieldErrors({});
                  setMessage(null);
                  // Kept from the last invitation: placement, role and language (redesign package 3).
                  setKept(
                    departmentId !== '' ||
                      branchId !== '' ||
                      managerId !== '' ||
                      role !== '' ||
                      invitationLocale !== props.defaultLocale,
                  );
                  setFormKey((k) => k + 1);
                }}
                data-testid="invite-another"
              >
                <Icon name="user-plus" className="size-4" />
                {text('created.inviteAnother')}
              </Button>
              <Button
                onClick={() => {
                  setOpen(false);
                }}
                data-testid="invite-done"
              >
                {text('done')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  if (canClose()) setOpen(false);
                }}
              >
                {text('cancel')}
              </Button>
              <Button
                type="submit"
                form="invite-user-form"
                busy={pending}
                data-testid="invite-submit"
              >
                {pending ? text('submitting') : text('submit')}
              </Button>
            </>
          )
        }
      >
        {created && value ? (
          <section className="flex flex-col gap-4" data-testid="invitation-created-panel">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="grid size-16 place-items-center rounded-[20px] bg-success-subtle text-success">
                <Icon name="mail" className="size-7" />
              </span>
              <h3 ref={successHeading} tabIndex={-1} className="m-0 text-lg font-bold">
                {text('created.title')}
              </h3>
              <p className="m-0 text-text-muted">
                {text('created.text').split('{name}').join(created.name)}
              </p>
            </div>
            <CopyBox
              label={props.copyTexts.codeLabel}
              value={displayInviteCode(value.inviteCode)}
              button={props.copyTexts.copyCode}
              copied={props.copyTexts.codeCopied}
              failed={props.copyTexts.copyFailed}
              large
              testId="invite-code"
            />
            <CopyBox
              label={text('linkLabel')}
              value={link}
              button={props.copyTexts.copyLink}
              copied={props.copyTexts.linkCopied}
              failed={props.copyTexts.copyFailed}
              testId="invite-link"
            />
            <p className="m-0 text-sm text-text-muted">{text('expiryNotice')}</p>
          </section>
        ) : (
          <form
            id="invite-user-form"
            key={formKey}
            className="flex flex-col gap-4"
            onSubmit={onSubmit}
            onChange={() => {
              setDirty(true);
            }}
            noValidate
            data-testid="invite-user"
          >
            {kept ? (
              <p className="m-0" data-testid="invite-kept">
                <Badge tone="brand">{text('keptFromLast')}</Badge>
              </p>
            ) : null}
            <TextField
              id="invite-email"
              name="email"
              type="email"
              label={text('email')}
              marker={text('required')}
              hint={text('emailHint')}
              required
              dir="ltr"
              autoComplete="off"
              maxLength={254}
              error={fieldErrors.email}
              disabled={pending}
            />
            {nameFields(nameLanguage, true)}
            <RoleSelect
              id="invite-role"
              value={role}
              onChange={(code) => {
                setRole(code);
                if (!needsScopeUnit(roles, code)) setScopeUnitId('');
                if (code !== DEPARTMENT_HEAD_ROLE) setHeadUnitId('');
                setFieldErrors(
                  ({ role: _cleared, scopeUnitId: _unit, headUnitId: _head, ...rest }) => rest,
                );
              }}
              options={roles}
              texts={props.roleTexts}
              marker={text('required')}
              hint={text('roleHint')}
              error={fieldErrors.role}
              disabled={pending}
            />
            {withUnit ? (
              <ScopeUnitSelect
                id="invite-unit"
                value={scopeUnitId}
                onChange={(id) => {
                  setScopeUnitId(id);
                  setFieldErrors(({ scopeUnitId: _cleared, ...rest }) => rest);
                }}
                choices={props.scopeUnits}
                texts={props.unitTexts}
                marker={text('required')}
                error={fieldErrors.scopeUnitId}
                disabled={pending}
              />
            ) : null}
            {picksHead ? (
              <HeadUnitField
                id="invite-head-unit"
                value={headUnitId}
                onChange={(id) => {
                  setHeadUnitId(id);
                  setFieldErrors(({ headUnitId: _cleared, ...rest }) => rest);
                }}
                units={props.scopeUnits}
                heads={props.headUnits.heads}
                personId={null}
                ownUnitId={ownUnitId}
                texts={props.headTexts}
                marker={text('required')}
                error={fieldErrors.headUnitId}
                disabled={pending}
                locale={props.uiLocale}
              />
            ) : null}
            {readsHeadedDepartments(roles, role) && !picksHead ? (
              <Alert tone="info" data-testid="role-departments-hint">
                {text('departmentsHint')}
              </Alert>
            ) : null}
            {lockedSome && props.labels.privilegedLocked ? (
              <p className="m-0 text-sm text-text-muted" data-testid="privileged-locked">
                {text('privilegedLocked')}
              </p>
            ) : null}
            <p className="m-0">
              <a
                href={props.rolesHref}
                className="inline-flex min-h-6 items-center text-sm pointer-coarse:min-h-11"
              >
                {text('rolesHelp')}
              </a>
            </p>
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="mb-1 text-sm font-semibold">{text('language')}</legend>
              <div className="flex flex-wrap gap-6">
                {(['ar', 'en'] as const).map((language) => (
                  <label key={language} className="inline-flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="invitationLocale"
                      value={language}
                      checked={invitationLocale === language}
                      disabled={pending}
                      onChange={() => {
                        setInvitationLocale(language);
                      }}
                      className="size-5 accent-primary"
                    />
                    <span lang={language}>{text(`language.${language}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {/* Everything optional waits behind «More options» (forms standard rule 9). Hidden, never
                unmounted: what was typed or chosen there is still sent. */}
            <button
              type="button"
              className="flex min-h-10 flex-wrap items-center gap-1.5 self-start rounded-full px-2 text-start text-sm font-semibold text-primary-text hover:bg-primary-subtle pointer-coarse:min-h-11"
              aria-expanded={more}
              aria-controls="invite-more"
              disabled={pending}
              onClick={() => {
                setMore((current) => !current);
              }}
              data-testid="invite-more"
            >
              <Icon name={more ? 'chevron-down' : 'chevron-end'} />
              {text('more')}
              <span className="font-normal text-text-muted">
                {' · '}
                {text(otherLanguage === 'ar' ? 'moreSummaryArabic' : 'moreSummaryEnglish')}
              </span>
            </button>
            <div id="invite-more" className={more ? 'flex flex-col gap-4' : 'hidden'}>
              <SelectField
                id="invite-department"
                label={text('department')}
                marker={text('optional')}
                value={departmentId}
                onChange={(event) => {
                  setDepartmentId(event.target.value);
                }}
                error={fieldErrors.departmentId}
                disabled={pending}
              >
                <option value="">{text('noDepartment')}</option>
                {props.departments.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id="invite-branch"
                label={text('branch')}
                marker={text('optional')}
                value={branchId}
                onChange={(event) => {
                  setBranchId(event.target.value);
                }}
                error={fieldErrors.branchId}
                disabled={pending}
              >
                <option value="">{text('noBranch')}</option>
                {props.branches.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </SelectField>
              <div className="flex flex-col gap-2">
                <SelectField
                  id="invite-manager"
                  label={text('manager')}
                  marker={text('optional')}
                  hint={
                    allManagers || departmentId === ''
                      ? text('managerHintAll')
                      : text('managerHint')
                  }
                  value={managerId}
                  onChange={(event) => {
                    setManagerId(event.target.value);
                  }}
                  error={fieldErrors.managerPersonId}
                  disabled={pending}
                >
                  <option value="">{text('noManager')}</option>
                  {managers.map((manager) => (
                    <option key={manager.personId} value={manager.personId}>
                      {manager.name}
                    </option>
                  ))}
                </SelectField>
                {departmentId !== '' ? (
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-controls="invite-manager"
                      aria-pressed={allManagers}
                      onClick={() => {
                        setAllManagers((all) => !all);
                      }}
                      disabled={pending}
                    >
                      {allManagers
                        ? text('departmentManagersOnly')
                        : text('allDepartmentsManagers')}
                    </Button>
                  </div>
                ) : null}
              </div>
              <TextField
                id="invite-employeeNumber"
                name="employeeNumber"
                label={text('employeeNumber')}
                marker={text('optional')}
                hint={text('employeeNumberHint')}
                dir="ltr"
                autoComplete="off"
                maxLength={40}
                error={fieldErrors.employeeNumber}
                disabled={pending}
              />
              {nameFields(otherLanguage, false)}
            </div>
            <Alert tone="info" data-testid="invite-notice">
              {text('expiryNotice')}
            </Alert>
            {message ? (
              <Alert tone="danger" data-testid="invite-message">
                {message}
              </Alert>
            ) : null}
          </form>
        )}
      </Dialog>
      <HeadConfirmDialog
        open={askReplace !== null && replacedHead !== null}
        title={headText('replaceTitle', { unit: headUnitName })}
        body={(() => {
          const name = askReplace
            ? createdName(props.uiLocale, {
                ar: [askReplace.firstNameAr, askReplace.familyNameAr],
                en: [askReplace.firstNameEn, askReplace.familyNameEn],
              })
            : '';
          return replacedHead && replacedHead.name !== ''
            ? headText('replaceBody', { unit: headUnitName, head: replacedHead.name, name })
            : headText('replaceBodyUnnamed', { unit: headUnitName, name });
        })()}
        confirm={headText('replaceConfirm')}
        cancel={headText('cancel')}
        close={text('close')}
        busy={pending}
        onConfirm={() => {
          if (askReplace) send({ ...askReplace, replaceHead: true });
        }}
        onCancel={() => {
          if (!pending) setAskReplace(null);
        }}
        testId="head-replace-dialog"
      />
      <DiscardDialog
        open={asking}
        texts={props.discardTexts}
        onKeep={() => {
          setAsking(false);
        }}
        onDiscard={() => {
          setAsking(false);
          setDirty(false);
          setOpen(false);
        }}
      />
    </>
  );
}
