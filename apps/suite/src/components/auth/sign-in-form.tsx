'use client';
import { Button } from '@jadarat/ui';
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
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="font-medium">
          {labels.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          dir="ltr"
          disabled={disabled || pending}
          className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-text"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="font-medium">
          {labels.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          dir="ltr"
          disabled={disabled || pending}
          className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-text"
        />
      </div>
      {message ? (
        <p
          role="alert"
          className="m-0 rounded-md border border-danger bg-danger-subtle px-3 py-2 text-text"
          data-testid="sign-in-error"
        >
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={disabled || pending}>
        {pending ? labels.submitting : labels.submit}
      </Button>
    </form>
  );
}
