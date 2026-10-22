'use client';
import { Alert, Button, Icon, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from 'react';
import { changeMyPasswordAction } from '../../actions/profile';
import { minFromParams, passwordRuleState, withMin } from '../../lib/password-rules';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { type PasswordRuleLabels, PasswordRulesList } from '../auth/password-rules-list';
import { useSessionRefusal } from '../auth/session-refusal';
import { fieldErrorCodes } from './field-errors';

export interface ChangePasswordFormProps {
  /** The strictest minimum of the account's organizations (PO decision 5, T-M2-10). */
  readonly minLength: number;
  readonly rules: PasswordRuleLabels;
  readonly labels: {
    readonly title: string;
    readonly intro: string;
    readonly current: string;
    readonly next: string;
    readonly nextHint: string;
    readonly confirm: string;
    readonly required: string;
    readonly submit: string;
    readonly submitting: string;
    readonly changed: string;
    readonly cancel: string;
  };
  readonly fieldTexts: {
    readonly tooShort: string;
    readonly tooLong: string;
    readonly mismatch: string;
    readonly currentRequired: string;
  };
  readonly errors: ErrorTexts;
}

/**
 * My profile → Password (FR-IAM-16), a row of the Sign-in and security tab (redesign package 6, PO 21 Oct
 * 2026): «Change password» opens the form in place — current password, new password twice, with the live
 * rules (the minimum is the strictest of the account's organizations, T-M2-10, named without saying whose)
 * and Cancel. Changed → a toast, the form closes, and the sessions list below refreshes (the other devices'
 * sessions ended). «The current password is incorrect.» sits on the field.
 */
export function ChangePasswordForm({
  minLength,
  rules: ruleLabels,
  labels,
  fieldTexts,
  errors,
}: ChangePasswordFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const rules = passwordRuleState(password, confirmation, minLength);
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  // The current-password field is disabled while the answer is awaited, so focus moves to it (a refused
  // password) once the answer is shown; closing the form returns focus to «Change password».
  const focusCurrent = useRef(false);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (pending || !focusCurrent.current) return;
    focusCurrent.current = false;
    document.getElementById('password-current')?.focus();
  }, [pending, fieldErrors.currentPassword]);
  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    document.getElementById('password-change')?.focus();
  }, [open]);

  function close() {
    returnFocus.current = true;
    setOpen(false);
    setPassword('');
    setConfirmation('');
    setProblem(null);
    setFieldErrors({});
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const input = {
      currentPassword: field('currentPassword'),
      newPassword: field('newPassword'),
      confirmPassword: field('confirmPassword'),
    };
    setProblem(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await changeMyPasswordAction(input);
      if (result.ok) {
        formRef.current?.reset();
        close();
        toast.success(labels.changed);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      if (result.error.code === 'VALIDATION_FAILED') {
        const codes = fieldErrorCodes(result.error);
        setFieldErrors({
          ...(codes.currentPassword ? { currentPassword: fieldTexts.currentRequired } : {}),
          ...(codes.newPassword
            ? {
                newPassword:
                  codes.newPassword === 'TOO_SMALL'
                    ? withMin(fieldTexts.tooShort, minFromParams(result.error.params, minLength))
                    : fieldTexts.tooLong,
              }
            : {}),
          ...(codes.confirmPassword ? { confirmPassword: fieldTexts.mismatch } : {}),
        });
        setProblem(errorText(result.error, errors));
        return;
      }
      // The current password is checked on its own field (same text as before).
      if (result.error.code === 'AUTH_CURRENT_PASSWORD_INVALID') {
        setFieldErrors({ currentPassword: errorText(result.error, errors) });
        focusCurrent.current = true;
        return;
      }
      setProblem(errorText(result.error, errors));
    });
  }

  return (
    <section aria-labelledby="password-title" data-testid="profile-password">
      <div className="grid grid-cols-1 items-start gap-2.5 md:grid-cols-[44px_minmax(0,1fr)_auto] md:gap-4">
        <span
          aria-hidden="true"
          className="hidden size-11 place-items-center rounded-[14px] bg-primary-subtle text-primary-text md:grid"
        >
          <Icon name="key" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="password-title" className="m-0 text-lg font-bold">
            {labels.title}
          </h2>
          <p className="m-0 mt-1 text-text-muted">{labels.intro}</p>
        </div>
        {open ? null : (
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(true);
                requestAnimationFrame(() => {
                  document.getElementById('password-current')?.focus();
                });
              }}
              id="password-change"
              data-testid="password-change"
            >
              <Icon name="pencil" />
              {labels.submit}
            </Button>
          </div>
        )}
      </div>
      {open ? (
        <form
          ref={formRef}
          className="mt-4 flex max-w-xl flex-col gap-4.5 rounded-xl border border-border bg-surface-sunken p-5 md:ms-15"
          onSubmit={onSubmit}
          noValidate
          aria-label={labels.submit}
        >
          <TextField
            id="password-current"
            name="currentPassword"
            type="password"
            label={labels.current}
            marker={labels.required}
            autoComplete="current-password"
            required
            dir="ltr"
            error={fieldErrors.currentPassword}
            disabled={pending}
          />
          <TextField
            id="password-new"
            name="newPassword"
            type="password"
            label={labels.next}
            marker={labels.required}
            hint={withMin(labels.nextHint, minLength)}
            autoComplete="new-password"
            required
            minLength={minLength}
            maxLength={72}
            dir="ltr"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            aria-describedby="password-rules"
            error={fieldErrors.newPassword}
            disabled={pending}
          />
          <PasswordRulesList id="password-rules" rules={rules} labels={ruleLabels} />
          <TextField
            id="password-confirm"
            name="confirmPassword"
            type="password"
            label={labels.confirm}
            marker={labels.required}
            autoComplete="new-password"
            required
            maxLength={72}
            dir="ltr"
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value);
            }}
            error={fieldErrors.confirmPassword}
            disabled={pending}
          />
          {problem ? (
            <Alert tone="danger" data-testid="password-message">
              {problem}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2.5">
            <Button type="submit" busy={pending} disabled={pending}>
              {pending ? labels.submitting : labels.submit}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={close}>
              {labels.cancel}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
