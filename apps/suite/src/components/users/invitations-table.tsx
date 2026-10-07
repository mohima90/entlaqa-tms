'use client';
import type { AppError } from '@jadarat/platform-core';
import { Alert, Badge, Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { resendInvitationAction, revokeInvitationAction } from '../../actions/invitations';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';

/** One invitation as shown (texts formatted on the server: no hydration differences). */
export interface InvitationRowView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly profileHref: string;
  readonly roleName: string | null;
  readonly sentText: string;
  readonly expiryText: string;
  readonly expired: boolean;
  readonly canResend: boolean;
}

export interface InvitationsTableProps {
  readonly rows: readonly InvitationRowView[];
  readonly showRole: boolean;
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

interface Outcome {
  readonly tone: 'success' | 'danger';
  readonly text: string;
}

/** Text for a refused resend or revoke: the specific reason when the server gave one. */
export function invitationErrorText(
  error: AppError,
  labels: Readonly<Record<string, string>>,
  errors: ErrorTexts,
): string {
  const code = fieldErrorCodes(error).invitationId;
  if (code === 'RESEND_LIMIT') return labels.resendLimit ?? errorText(error, errors);
  if (code === 'NOT_PENDING') return labels.notPending ?? errorText(error, errors);
  if (code === 'ROLE_NOT_ALLOWED') return labels.roleNotAllowed ?? errorText(error, errors);
  return errorText(error, errors);
}

/**
 * Pending and expired invitations on the users list (T-M2-07, FR-IAM-03; screen 1 `invited` tab):
 * resend inline (up to 3 times), revoke after a confirmation.
 */
export function InvitationsTable({ rows, showRole, labels, errors }: InvitationsTableProps) {
  const text = (key: string, name?: string) => (labels[key] ?? key).replace('{name}', name ?? '');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const run = (
    id: string,
    action: typeof resendInvitationAction,
    success: string,
    after?: () => void,
  ) => {
    setOutcome(null);
    setBusyId(id);
    startTransition(async () => {
      const result = await action({ invitationId: id });
      setBusyId(null);
      after?.();
      setOutcome(
        result.ok
          ? { tone: 'success', text: success }
          : { tone: 'danger', text: invitationErrorText(result.error, labels, errors) },
      );
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {outcome?.tone === 'danger' ? (
        <Alert tone="danger" data-testid="invitations-message">
          {outcome.text}
        </Alert>
      ) : null}
      {/* Kept rendered so a confirmation is announced when its text changes (Alert docs). */}
      <div role="status" aria-live="polite">
        {outcome?.tone === 'success' ? (
          <Alert tone="success" role="none" data-testid="invitations-message">
            {outcome.text}
          </Alert>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-start" data-testid="invitations-table">
          <caption className="sr-only">{text('tableCaption')}</caption>
          <thead className="bg-surface-sunken text-sm">
            <tr>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                {text('columns.name')}
              </th>
              {showRole ? (
                <th scope="col" className="px-4 py-3 text-start font-semibold">
                  {text('columns.primaryRole')}
                </th>
              ) : null}
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                {text('columns.status')}
              </th>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                {text('columns.sent')}
              </th>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                {text('columns.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const busy = pending && busyId === row.id;
              return (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="px-4 py-3">
                    <a href={row.profileHref} className="font-medium">
                      {row.name}
                    </a>
                    <div className="text-sm text-text-muted">
                      <bdi dir="ltr">{row.email}</bdi>
                    </div>
                  </td>
                  {showRole ? <td className="px-4 py-3">{row.roleName}</td> : null}
                  <td className="px-4 py-3">
                    <Badge tone={row.expired ? 'warning' : 'info'}>
                      {row.expired ? text('status.expired') : text('status.pending')}
                    </Badge>
                    <div className="mt-1 text-sm text-text-muted">{row.expiryText}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">{row.sentText}</td>
                  <td className="px-4 py-3">
                    {confirming === row.id ? (
                      <div
                        className="flex flex-col gap-2"
                        role="group"
                        aria-labelledby={`revoke-${row.id}-question`}
                      >
                        <p id={`revoke-${row.id}-question`} className="m-0 text-sm">
                          {text('revokeConfirm', row.name)}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="danger"
                            disabled={pending}
                            onClick={() => {
                              run(row.id, revokeInvitationAction, text('revoked'), () => {
                                setConfirming(null);
                              });
                            }}
                          >
                            {busy ? text('working') : text('revokeConfirmButton')}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={pending}
                            onClick={() => {
                              setConfirming(null);
                            }}
                          >
                            {text('keep')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {row.canResend ? (
                          <Button
                            variant="secondary"
                            disabled={pending}
                            onClick={() => {
                              run(row.id, resendInvitationAction, text('resent'));
                            }}
                          >
                            {busy ? text('working') : text('resend')}
                            {/* The visible text stays first in the name (WCAG 2.5.3). */}
                            <span className="sr-only">{` (${row.name})`}</span>
                          </Button>
                        ) : (
                          <p className="m-0 max-w-56 text-sm text-text-muted">
                            {text('resendLimitShort')}
                          </p>
                        )}
                        <Button
                          variant="ghost"
                          disabled={pending}
                          onClick={() => {
                            setOutcome(null);
                            setConfirming(row.id);
                          }}
                        >
                          {text('revoke')}
                          <span className="sr-only">{` (${row.name})`}</span>
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface ExpiredInvitationsBannerProps {
  /** Expired invitations that can still be resent. */
  readonly ids: readonly string[];
  readonly message: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/** Screen 1 banner: invitations expired before acceptance, with "resend the expired invitations". */
export function ExpiredInvitationsBanner({
  ids,
  message,
  labels,
  errors,
}: ExpiredInvitationsBannerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const resendAll = () => {
    setFailure(null);
    setDone(null);
    startTransition(async () => {
      let sent = 0;
      for (const id of ids) {
        const result = await resendInvitationAction({ invitationId: id });
        if (!result.ok) {
          setFailure(invitationErrorText(result.error, labels, errors));
          break;
        }
        sent += 1;
      }
      if (sent > 0) setDone((labels.resentExpired ?? '').replace('{count}', String(sent)));
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="expired-invitations">
      <Alert tone="warning">
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-0 flex-1 basis-80">{message}</span>
          {ids.length > 0 ? (
            <Button variant="secondary" disabled={pending} onClick={resendAll}>
              {pending ? labels.working : labels.resendExpired}
            </Button>
          ) : null}
        </div>
      </Alert>
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      <div role="status" aria-live="polite">
        {done ? (
          <Alert tone="success" role="none">
            {done}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
