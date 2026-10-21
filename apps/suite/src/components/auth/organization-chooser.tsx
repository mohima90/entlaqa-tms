'use client';
import { Alert, Icon, initialsOf } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { selectOrganizationAction } from '../../auth/actions';
import { AuthSpinner } from './auth-field';
import { type ErrorTexts, errorText } from './error-text';

export interface OrganizationChooserProps {
  readonly locale: string;
  readonly organizations: readonly { readonly tenantId: string; readonly name: string }[];
  readonly pendingLabel: string;
  readonly errors: ErrorTexts;
}

/**
 * One button per organization of the current session (ADR 0002 §3: explicit POST tenant switch). Direction
 * C: each is a whole-row target — the initials, the name and a chevron; the chosen row shows it is busy.
 */
export function OrganizationChooser({
  locale,
  organizations,
  pendingLabel,
  errors,
}: OrganizationChooserProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function choose(tenantId: string) {
    setChosen(tenantId);
    setMessage(null);
    startTransition(async () => {
      const result = await selectOrganizationAction({ tenantId });
      if (result.ok) {
        // The organization may ask for an authenticator code or app first (T-M2-10).
        router.replace(`/${locale}/${result.value.next === 'mfa' ? 'mfa' : 'suite'}`);
        router.refresh();
      } else {
        setMessage(errorText(result.error, errors));
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {organizations.map((org, index) => {
          const busy = pending && chosen === org.tenantId;
          return (
            <li key={org.tenantId}>
              <button
                type="button"
                disabled={pending}
                aria-busy={busy || undefined}
                onClick={() => {
                  choose(org.tenantId);
                }}
                className="flex min-h-19 w-full items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 text-start transition-colors hover:border-border-strong hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-80"
              >
                <span
                  aria-hidden="true"
                  className={`grid size-12 shrink-0 place-items-center rounded-[14px] text-[15px] font-bold ${
                    index === 0
                      ? 'bg-brand-gradient text-on-brand'
                      : 'bg-primary-subtle text-primary-text'
                  }`}
                >
                  {initialsOf(org.name)}
                </span>
                <span className="min-w-0 flex-1 text-[17px] font-semibold [overflow-wrap:anywhere]">
                  {busy ? pendingLabel : org.name}
                </span>
                {busy ? (
                  <AuthSpinner />
                ) : (
                  <Icon name="chevron-end" className="size-5 text-text-muted" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {message ? <Alert tone="danger">{message}</Alert> : null}
    </div>
  );
}
