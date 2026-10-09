'use client';
import { Alert, Button, TextField } from '@jadarat/ui';
import { type SyntheticEvent, useRef, useState, useTransition } from 'react';
import { changeMyPasswordAction } from '../../actions/profile';
import { minFromParams, passwordRuleState, withMin } from '../../lib/password-rules';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { type PasswordRuleLabels, PasswordRulesList } from '../auth/password-rules-list';
import { fieldErrorCodes } from './field-errors';

export interface ChangePasswordFormProps {
  /** The strictest minimum of the account's organizations (PO decision 5, T-M2-10). */
  readonly minLength: number;
  readonly rules: PasswordRuleLabels;
  readonly labels: {
    readonly current: string;
    readonly next: string;
    readonly nextHint: string;
    readonly confirm: string;
    readonly required: string;
    readonly submit: string;
    readonly submitting: string;
    readonly changed: string;
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
 * My profile → change password (FR-IAM-16): current password, new password twice, with the live rules —
 * the minimum is the strictest of the account's organizations (T-M2-10), named without saying whose.
 */
export function ChangePasswordForm({
  minLength,
  rules: ruleLabels,
  labels,
  fieldTexts,
  errors,
}: ChangePasswordFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const rules = passwordRuleState(password, confirmation, minLength);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

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
    setMessage(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await changeMyPasswordAction(input);
      if (result.ok) {
        formRef.current?.reset();
        setPassword('');
        setConfirmation('');
        setMessage({ tone: 'success', text: labels.changed });
        return;
      }
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
      }
      setMessage({ tone: 'danger', text: errorText(result.error, errors) });
    });
  }

  return (
    <form ref={formRef} className="flex max-w-md flex-col gap-4" onSubmit={onSubmit} noValidate>
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
      {message ? (
        <Alert tone={message.tone} data-testid="password-message">
          {message.text}
        </Alert>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? labels.submitting : labels.submit}
        </Button>
      </div>
    </form>
  );
}
