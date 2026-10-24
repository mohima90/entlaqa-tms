'use client';
import { Alert, Badge, Button, Dialog, Icon, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { forgetKeptSessionsAction } from '../../actions/security';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';

/**
 * My profile › Security › Browsers kept signed in (WP-ADM-05, FR-IAM-12; business flow EP-AUTH-signin-extras
 * screen 3, PO 23 Oct 2026): «Remember this browser» = «keep me signed in». The sessions the member chose to keep,
 * with when each signed in and until when it stays signed in, and «Forget all» (a confirmation first; the
 * sessions then follow the organization's normal rules). When the organization does not keep people signed in
 * the section says so. Dates come formatted from the server; a browser is described by name and system, never
 * shown raw. Signing out, «End sessions», deactivation and a password change end a kept session too.
 */
export interface RememberedBrowserRow {
  readonly id: string;
  readonly device: string;
  readonly remembered: string;
  /** Until when it stays signed in, formatted; null: no longer valid (shown as expired). */
  readonly until: string | null;
  readonly isCurrent: boolean;
}

export interface RememberedBrowsersProps {
  /** The organization's current period in days; 0: it does not remember browsers. */
  readonly days: number;
  readonly rows: readonly RememberedBrowserRow[];
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

export function RememberedBrowsers({ days, rows, labels, errors }: RememberedBrowsersProps) {
  const t = (key: string) => labels[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function forgetAll() {
    setMessage(null);
    startTransition(async () => {
      const result = await forgetKeptSessionsAction({});
      setConfirming(false);
      if (result.ok) {
        toast.success(t('forgotten'));
        router.refresh();
      } else if (!sessionRefused(result.error)) {
        setMessage(errorText(result.error, errors));
      }
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="remembered-browsers">
      {days === 0 ? (
        <p className="m-0 text-text-muted" data-testid="remembered-off">
          {t('off')}
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 font-semibold" data-testid="remembered-count">
            {t('count')}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending || rows.length === 0}
            onClick={() => {
              setConfirming(true);
            }}
            data-testid="remembered-forget-all"
          >
            {t('forgetAll')}
          </Button>
        </div>
      )}
      {days > 0 && rows.length === 0 ? (
        <p className="m-0 text-text-muted" data-testid="remembered-none">
          {t('none')}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {rows.map((row) => (
            <li
              key={row.id}
              className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3.5 rounded-xl border border-border bg-surface px-4 py-3.5"
              data-testid="remembered-row"
            >
              <span
                aria-hidden="true"
                className="grid size-10 place-items-center rounded-[14px] bg-surface-hover text-text-muted"
              >
                <Icon name="monitor" className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <bdi dir="ltr" className="font-semibold">
                    {row.device}
                  </bdi>
                  {row.isCurrent ? <Badge tone="info">{t('current')}</Badge> : null}
                </p>
                <p className="m-0 mt-0.5 text-[13.5px] text-text-muted">
                  {row.remembered} ·{' '}
                  {row.until === null ? t('expired') : t('until').replace('{date}', row.until)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? (
        <Alert tone="danger" data-testid="remembered-message">
          {message}
        </Alert>
      ) : null}
      <Dialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        canClose={() => !pending}
        title={t('forgetTitle')}
        description={t('forgetText')}
        closeLabel={t('close')}
        tone="warning"
        data-testid="remembered-confirm"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={forgetAll}
              data-testid="remembered-forget-confirm"
            >
              {t('forgetConfirm')}
            </Button>
          </>
        }
      />
    </div>
  );
}
