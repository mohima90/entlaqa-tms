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
    /** «(مطلوب)» / "(required)" — both fields are required (design principles §4). */
    readonly required: string;
    /** «تذكّر هذا المتصفح» / "Remember this browser" and what it does. */
    readonly rememberBrowser: string;
    readonly rememberBrowserHint: string;
    readonly submit: string;
    readonly submitting: string;
  };
  readonly errors: ErrorTexts;
}

/**
 * E-mail + password sign-in (ADR 0003 §2). Runs the server action; never talks to Auth directly.
 * «تذكّر هذا المتصفح» / "Remember this browser" (PO decision 9 Oct 2026, T-M2-11): a native check box,
 * unticked by default, its explanation tied to it (aria-describedby) — only a sign-in with it ticked trusts
 * this browser for 30 days.
 */
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
    const remember = form.get('remember') === 'on';
    setMessage(null);
    startTransition(async () => {
      const result = await signInAction({ email, password, remember });
      if (result.ok) {
        const paths = {
          home: '/suite',
          mfa: '/mfa',
          'choose-organization': '/select-organization',
        };
        // 'mfa': the organization asks for an authenticator code or app first (T-M2-10).
        router.replace(`/${locale}${paths[result.value.next]}`);
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
        marker={labels.required}
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
        marker={labels.required}
        autoComplete="current-password"
        required
        dir="ltr"
        disabled={disabled || pending}
      />
      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            name="remember"
            aria-describedby="remember-browser-hint"
            disabled={disabled || pending}
            className="size-5 shrink-0"
            data-testid="remember-browser"
          />
          {labels.rememberBrowser}
        </label>
        <p id="remember-browser-hint" className="m-0 ms-8 text-sm text-text-muted">
          {labels.rememberBrowserHint}
        </p>
      </div>
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
