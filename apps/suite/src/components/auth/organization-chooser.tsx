'use client';
import { Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { selectOrganizationAction } from '../../auth/actions';
import { type ErrorTexts, errorText } from './error-text';

export interface OrganizationChooserProps {
  readonly locale: string;
  readonly organizations: readonly { readonly tenantId: string; readonly name: string }[];
  readonly pendingLabel: string;
  readonly errors: ErrorTexts;
}

/** One button per organization of the current session (ADR 0002 §3: explicit POST tenant switch). */
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
        router.replace(`/${locale}/suite`);
        router.refresh();
      } else {
        setMessage(errorText(result.error, errors));
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {organizations.map((org) => (
          <li key={org.tenantId}>
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-start"
              disabled={pending}
              onClick={() => {
                choose(org.tenantId);
              }}
            >
              {pending && chosen === org.tenantId ? pendingLabel : org.name}
            </Button>
          </li>
        ))}
      </ul>
      {message ? (
        <p
          role="alert"
          className="m-0 rounded-md border border-danger bg-danger-subtle px-3 py-2 text-text"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
