'use client';
import { Alert, Button, TextField } from '@jadarat/ui';
import { type SyntheticEvent, useRef, useState, useTransition } from 'react';
import { changeMyPasswordAction } from '../../actions/profile';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from './field-errors';

export interface ChangePasswordFormProps {
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
  readonly fieldTexts: { readonly tooShort: string; readonly mismatch: string };
  readonly errors: ErrorTexts;
}

/** My profile → change password (FR-IAM-16): current password, new password twice. */
export function ChangePasswordForm({ labels, fieldTexts, errors }: ChangePasswordFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
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
        setMessage({ tone: 'success', text: labels.changed });
        return;
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        const codes = fieldErrorCodes(result.error);
        setFieldErrors({
          ...(codes.newPassword ? { newPassword: fieldTexts.tooShort } : {}),
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
        disabled={pending}
      />
      <TextField
        id="password-new"
        name="newPassword"
        type="password"
        label={labels.next}
        marker={labels.required}
        hint={labels.nextHint}
        autoComplete="new-password"
        required
        minLength={12}
        maxLength={128}
        dir="ltr"
        error={fieldErrors.newPassword}
        disabled={pending}
      />
      <TextField
        id="password-confirm"
        name="confirmPassword"
        type="password"
        label={labels.confirm}
        marker={labels.required}
        autoComplete="new-password"
        required
        maxLength={128}
        dir="ltr"
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
