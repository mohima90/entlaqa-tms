'use client';
import { Alert, Button, TextField } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { signInAction } from '../../auth/actions';
import { type ErrorTexts, errorText } from './error-text';

export interface SignInFormProps {
  readonly locale: string;
  readonly disabled: boolean;
  readonly labels: {
    readonly email: string;
    readonly password: string;
    readonly submit: string;
    readonly submitting: string;
  };
  readonly errors: ErrorTexts;
}

/** E-mail + password sign-in (ADR 0003 §2). Runs the server action; never talks to Auth directly. */
export function SignInForm({ locale, disabled, labels, errors }: SignInFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const email = field('email');
    const password = field('password');
    setMessage(null);
    startTransition(async () => {
      const result = await signInAction({ email, password });
      if (result.ok) {
        router.replace(
          `/${locale}${result.value.next === 'home' ? '/suite' : '/select-organization'}`,
        );
        router.refresh();
      } else {
        setMessage(errorText(result.error, errors));
      }
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <TextField
        id="email"
        name="email"
        type="email"
        label={labels.email}
        autoComplete="username"
        required
        dir="ltr"
        disabled={disabled || pending}
      />
      <TextField
        id="password"
        name="password"
        type="password"
        label={labels.password}
        autoComplete="current-password"
        required
        dir="ltr"
        disabled={disabled || pending}
      />
      {message ? (
        <Alert tone="danger" data-testid="sign-in-error">
          {message}
        </Alert>
      ) : null}
      <Button type="submit" disabled={disabled || pending}>
        {pending ? labels.submitting : labels.submit}
      </Button>
    </form>
  );
}
