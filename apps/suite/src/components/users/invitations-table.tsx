'use client';
import type { AppError, Result } from '@jadarat/platform-core';
import { Alert, Badge, Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  resendInvitationAction,
  revokeInvitationAction,
  viewInvitationCodeAction,
  viewPrivilegedInvitationCodeAction,
} from '../../actions/invitations';
import { sendHeldInvitationsAction } from '../../actions/user-import';
import { AuthIcon } from '../auth/auth-icons';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';
import { InviteCodeCopy, type InviteCopyTexts } from './invite-code-copy';

/** One invitation as shown (texts formatted on the server: no hydration differences). */
export interface InvitationRowView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly profileHref: string;
  readonly roleName: string | null;
  readonly sentText: string;
  /** «تنتهي في …» / «انتهت في …»; for held and scheduled invitations, what happens next. */
  readonly expiryText: string;
  /** `held`: added by a bulk import without its e-mail; `scheduled`: its e-mail goes out shortly (T-M2-12). */
  readonly state: 'pending' | 'expired' | 'held' | 'scheduled';
  /** «من استيراد في …» when a bulk import added the person (T-M2-12). */
  readonly fromImportText: string | null;
  readonly canResend: boolean;
  /**
   * Its code (Kawadir's copy code / copy link) — never in the list itself; read when copied, through an
   * authorized and audited action (security review M2):
   *   `copy`            an ordinary invitation's code (platform.user.invite)
   *   `copyPrivileged`  a privileged invitation's code (platform.role.assign_privileged, strict session)
   *   `notAllowed`      a privileged invitation on an HR Manager's list: «لا يمكنك نسخ رمز دعوة بدور مميز»
   *   `none`            no code to copy yet (e.g. a link e-mailed before codes): use Resend
   */
  readonly codeAccess: 'copy' | 'copyPrivileged' | 'notAllowed' | 'none';
  /** Codes issued so far: a new one (resend) resets the copied code shown. */
  readonly sendCount: number;
}

const STATE_TONE = {
  pending: 'info',
  expired: 'warning',
  held: 'neutral',
  scheduled: 'info',
} as const;

export interface InvitationsTableProps {
  readonly rows: readonly InvitationRowView[];
  readonly showRole: boolean;
  readonly copyTexts: InviteCopyTexts;
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
  if (code === 'NO_CODE') return labels.noCode ?? errorText(error, errors);
  if (fieldErrorCodes(error).invitations === 'NOTHING_TO_SEND') {
    return labels.nothingToSend ?? errorText(error, errors);
  }
  if (fieldErrorCodes(error).invitations === 'SEND_NOT_ALLOWED') {
    return labels.sendNotAllowed ?? errorText(error, errors);
  }
  return errorText(error, errors);
}

type InvitationAction = (input: { invitationId: string }) => Promise<Result<unknown, AppError>>;

/** «إرسال الدعوة» of one held invitation (T-M2-12): the import's pipeline sends it shortly. */
const sendHeld: InvitationAction = ({ invitationId }) =>
  sendHeldInvitationsAction({ invitationIds: [invitationId] });

/**
 * Pending and expired invitations on the users list (T-M2-07, FR-IAM-03; screen 1 `invited` tab), laid
 * out as Kawadir ATS's pending-invite rows (PO, 16 Oct 2026): who and what, then the invitation code with
 * «نسخ الرمز» / «نسخ الرابط» (read when copied, audited — security review M2), «إعادة إرسال الدعوة» (a new code; up to 3 times) and «إلغاء الدعوة» after a
 * confirmation. People a bulk import added without their e-mail show «لم تُرسل الدعوة» with «إرسال
 * الدعوة» (T-M2-12, FR-IAM-04); their code comes when it is sent.
 */
export function InvitationsTable({
  rows,
  showRole,
  copyTexts,
  labels,
  errors,
}: InvitationsTableProps) {
  const text = (key: string, name?: string) => (labels[key] ?? key).replace('{name}', name ?? '');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const run = (id: string, action: InvitationAction, success: string, after?: () => void) => {
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
      <h2 className="sr-only">{text('tableCaption')}</h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="invitations-list">
        {rows.map((row) => {
          const busy = pending && busyId === row.id;
          return (
            <li
              key={row.id}
              className="rounded-lg border border-border bg-surface p-4 shadow-1"
              data-testid="invitation-row"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 basis-72 items-start gap-4">
                  <span
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning-strong"
                    aria-hidden="true"
                  >
                    <AuthIcon name="clock" className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <a href={row.profileHref} className="font-medium">
                      {row.name}
                    </a>
                    <div className="text-sm text-text-muted">
                      <bdi dir="ltr">{row.email}</bdi>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
                      {showRole && row.roleName ? (
                        <Badge tone="neutral">{row.roleName}</Badge>
                      ) : null}
                      <Badge tone={STATE_TONE[row.state]}>{text(`status.${row.state}`)}</Badge>
                      <span aria-hidden="true">•</span>
                      <span>{row.sentText}</span>
                      {row.expiryText ? (
                        <>
                          <span aria-hidden="true">•</span>
                          <span>{row.expiryText}</span>
                        </>
                      ) : null}
                    </div>
                    {row.fromImportText ? (
                      <div className="text-sm text-text-muted">{row.fromImportText}</div>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col items-start gap-2">
                  {row.state === 'pending' &&
                  (row.codeAccess === 'copy' || row.codeAccess === 'copyPrivileged') ? (
                    <InviteCodeCopy
                      // A new code (resend) starts unread again.
                      key={`${row.id}-${String(row.sendCount)}`}
                      load={() =>
                        (row.codeAccess === 'copyPrivileged'
                          ? viewPrivilegedInvitationCodeAction
                          : viewInvitationCodeAction)({ invitationId: row.id })
                      }
                      loadErrorText={(error) => invitationErrorText(error, labels, errors)}
                      texts={copyTexts}
                      name={row.name}
                    />
                  ) : row.state === 'pending' ? (
                    <p
                      className="m-0 max-w-64 text-sm text-text-muted"
                      data-testid="invite-no-code"
                    >
                      {text(row.codeAccess === 'notAllowed' ? 'noCodePrivileged' : 'noCode')}
                    </p>
                  ) : null}
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
                      {row.state === 'held' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          data-testid="send-held-invitation"
                          onClick={() => {
                            run(row.id, sendHeld, text('sentHeld'));
                          }}
                        >
                          {busy ? text('working') : text('sendHeld')}
                          <span className="sr-only">{` (${row.name})`}</span>
                        </Button>
                      ) : row.state === 'scheduled' ? null : row.canResend ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            run(row.id, resendInvitationAction, text('resent'));
                          }}
                        >
                          <AuthIcon name="refresh" />
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
                        variant="danger-outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          setOutcome(null);
                          setConfirming(row.id);
                        }}
                      >
                        <AuthIcon name="x" />
                        {text('revoke')}
                        <span className="sr-only">{` (${row.name})`}</span>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
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
