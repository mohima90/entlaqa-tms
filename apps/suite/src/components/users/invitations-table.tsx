'use client';
import type { AppError, Result } from '@jadarat/platform-core';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  ListCard,
  ListCards,
  tableClasses,
  toast,
} from '@jadarat/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState, useTransition } from 'react';
import {
  resendInvitationAction,
  revokeInvitationAction,
  viewInvitationCodeAction,
  viewPrivilegedInvitationCodeAction,
} from '../../actions/invitations';
import { sendHeldInvitationsAction } from '../../actions/user-import';
import { displayInviteCode } from '../../lib/invite-code';
import { inviteLink } from '../../lib/invite-link';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';
import type { InviteCodeValue, InviteCopyTexts } from './invite-code-copy';

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
  /** Codes issued so far: a new one (resend) resets the code read before. */
  readonly sendCount: number;
}

const STATE_TONE = {
  pending: 'warning',
  expired: 'danger',
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
 * The «Pending invites» view of Team members (T-M2-07, FR-IAM-03; redesign package 3): one row per
 * invitation not accepted yet — who, role, status, when it was sent — with its main action on the row
 * («Copy invite link», «Resend invitation», or «Send the invitation» for one an import held, T-M2-12) and
 * the rest in its ⋯ menu (Copy code, Resend, Revoke). The code is never in the page: it is read when copied
 * through the authorized, audited action (security review M2). Revoking keeps its red confirmation (it
 * cannot be undone). Outcomes are toasts; when the browser refuses the clipboard, the link or code is shown
 * selected for a manual copy («Select the text and copy it»).
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
  const [revoking, setRevoking] = useState<InvitationRowView | null>(null);
  const [manual, setManual] = useState<{ title: string; value: string } | null>(null);
  // Codes read on this page, per invitation and resend (read once, then copied again without a read).
  const codes = useRef(new Map<string, InviteCodeValue>());

  const run = (row: InvitationRowView, action: InvitationAction, success: string) => {
    setBusyId(row.id);
    startTransition(async () => {
      const result = await action({ invitationId: row.id });
      setBusyId(null);
      setRevoking(null);
      if (result.ok) toast.success(success);
      else toast.error(invitationErrorText(result.error, labels, errors));
      router.refresh();
    });
  };

  const copy = async (row: InvitationRowView, what: 'code' | 'link') => {
    const key = `${row.id}:${String(row.sendCount)}`;
    let value = codes.current.get(key);
    if (!value) {
      setBusyId(row.id);
      const answer = await (
        row.codeAccess === 'copyPrivileged'
          ? viewPrivilegedInvitationCodeAction
          : viewInvitationCodeAction
      )({ invitationId: row.id });
      setBusyId(null);
      if (!answer.ok) {
        toast.error(invitationErrorText(answer.error, labels, errors));
        return;
      }
      value = answer.value;
      codes.current.set(key, value);
    }
    const copied =
      what === 'code'
        ? displayInviteCode(value.inviteCode)
        : (value.inviteLink ?? inviteLink(window.location.origin, value.locale, value.inviteCode));
    try {
      await navigator.clipboard.writeText(copied);
      toast.success(what === 'code' ? copyTexts.codeCopied : copyTexts.linkCopied);
    } catch {
      toast.error(copyTexts.copyFailed, { duration: 6000 });
      setManual({
        title: what === 'code' ? copyTexts.codeLabel : (labels.linkLabel ?? ''),
        value: copied,
      });
    }
  };

  const mayCopy = (row: InvitationRowView) =>
    row.state === 'pending' && (row.codeAccess === 'copy' || row.codeAccess === 'copyPrivileged');

  const mainAction = (row: InvitationRowView): ReactNode => {
    const busy = pending && busyId === row.id;
    const suffix = <span className="sr-only">{` (${row.name})`}</span>;
    if (row.state === 'held') {
      return (
        <Button
          variant="secondary"
          size="sm"
          busy={busy}
          disabled={pending}
          onClick={() => {
            run(row, sendHeld, text('sentHeld'));
          }}
          data-testid="send-held-invitation"
        >
          <Icon name="mail" className="size-4" />
          {text('sendHeld')}
          {suffix}
        </Button>
      );
    }
    if (row.state === 'scheduled') return null;
    if (mayCopy(row)) {
      return (
        <Button
          variant="secondary"
          size="sm"
          disabled={busyId === row.id}
          onClick={() => {
            void copy(row, 'link');
          }}
          data-testid="copy-invite-link"
        >
          <Icon name="copy" className="size-4" />
          {copyTexts.copyLink}
          {suffix}
        </Button>
      );
    }
    if (row.canResend) {
      return (
        <Button
          variant="secondary"
          size="sm"
          busy={busy}
          disabled={pending}
          onClick={() => {
            run(row, resendInvitationAction, text('resent'));
          }}
          data-testid="resend-invitation"
        >
          <Icon name="sync" className="size-4" />
          {text('resend')}
          {suffix}
        </Button>
      );
    }
    return (
      <p className="m-0 max-w-56 text-sm text-text-muted" data-testid="invite-no-code">
        {row.state === 'pending'
          ? text(row.codeAccess === 'notAllowed' ? 'noCodePrivileged' : 'noCode')
          : text('resendLimitShort')}
      </p>
    );
  };

  const menu = (row: InvitationRowView) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="grid size-9 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
        aria-label={text('moreActions', row.name)}
        data-testid={`invitation-menu-${row.id}`}
      >
        <Icon name="more" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <Link href={row.profileHref}>
            <Icon name="user" />
            {text('openProfile')}
          </Link>
        </DropdownMenuItem>
        {mayCopy(row) ? (
          <DropdownMenuItem
            onSelect={() => {
              void copy(row, 'code');
            }}
            data-testid="copy-invite-code"
          >
            <Icon name="copy" />
            {copyTexts.copyCode}
          </DropdownMenuItem>
        ) : null}
        {row.canResend && mayCopy(row) ? (
          <DropdownMenuItem
            disabled={pending}
            onSelect={() => {
              run(row, resendInvitationAction, text('resent'));
            }}
            data-testid="menu-resend-invitation"
          >
            <Icon name="sync" />
            {text('resend')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          tone="danger"
          disabled={pending}
          onSelect={() => {
            setRevoking(row);
          }}
          data-testid="revoke-invitation"
        >
          <Icon name="close" />
          {text('revoke')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const status = (row: InvitationRowView) => (
    <span className="flex flex-col items-start gap-1">
      <Badge tone={STATE_TONE[row.state]} dot>
        {text(`status.${row.state}`)}
      </Badge>
      {row.fromImportText ? (
        <span className="text-sm text-text-muted">{row.fromImportText}</span>
      ) : null}
    </span>
  );

  const sent = (row: InvitationRowView) => (
    <span className="flex flex-col">
      <span>{row.sentText}</span>
      {row.expiryText ? <span className="text-sm text-text-muted">{row.expiryText}</span> : null}
    </span>
  );

  return (
    <>
      <div className="hidden md:block" data-testid="invitations-list">
        <div className={tableClasses.wrapper}>
          <table className={tableClasses.table} data-testid="invitations-table">
            <caption className="sr-only">{text('tableCaption')}</caption>
            <thead className={tableClasses.header}>
              <tr>
                <th scope="col" className={tableClasses.head}>
                  {text('columns.name')}
                </th>
                {showRole ? (
                  <th scope="col" className={tableClasses.head}>
                    {text('columns.primaryRole')}
                  </th>
                ) : null}
                <th scope="col" className={tableClasses.head}>
                  {text('columns.status')}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {text('columns.sent')}
                </th>
                <th scope="col" className={tableClasses.head}>
                  <span className="sr-only">{text('columns.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={tableClasses.row} data-testid="invitation-row">
                  <td className={tableClasses.cell}>
                    <div className="flex items-center gap-3">
                      <Avatar name={row.name} tone="soft" size="md" />
                      <div className="min-w-0">
                        <Link href={row.profileHref} className="font-semibold text-text">
                          {row.name}
                        </Link>
                        <div className="text-sm text-text-muted">
                          <bdi dir="ltr">{row.email}</bdi>
                        </div>
                      </div>
                    </div>
                  </td>
                  {showRole ? <td className={tableClasses.cell}>{row.roleName}</td> : null}
                  <td className={tableClasses.cell}>{status(row)}</td>
                  <td className={tableClasses.cell}>{sent(row)}</td>
                  <td className={`${tableClasses.cell} text-end`}>
                    <div className="flex items-center justify-end gap-2">
                      {mainAction(row)}
                      {menu(row)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ListCards data-testid="invitations-cards">
        {rows.map((row) => (
          <ListCard
            key={row.id}
            leading={<Avatar name={row.name} tone="soft" size="md" />}
            title={<Link href={row.profileHref}>{row.name}</Link>}
            detail={[row.roleName, row.sentText].filter(Boolean).join(' · ')}
            status={
              <span className="flex flex-col items-start gap-2">
                {status(row)}
                {mainAction(row)}
              </span>
            }
            action={menu(row)}
          />
        ))}
      </ListCards>

      <Dialog
        open={revoking !== null}
        onClose={() => {
          if (!pending) setRevoking(null);
        }}
        tone="danger"
        title={text('revoke')}
        description={revoking ? text('revokeConfirm', revoking.name) : undefined}
        closeLabel={text('keep')}
        size="sm"
        data-testid="revoke-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setRevoking(null);
              }}
            >
              {text('keep')}
            </Button>
            <Button
              variant="danger"
              busy={pending}
              onClick={() => {
                if (revoking) run(revoking, revokeInvitationAction, text('revoked'));
              }}
              data-testid="revoke-confirm"
            >
              {pending ? text('working') : text('revokeConfirmButton')}
            </Button>
          </>
        }
      />
      <ManualCopyDialog
        value={manual}
        closeLabel={text('close')}
        onClose={() => {
          setManual(null);
        }}
      />
    </>
  );
}

/** The browser refused the clipboard: the text, selected, to copy by hand (today's fallback). */
function ManualCopyDialog({
  value,
  closeLabel,
  onClose,
}: {
  readonly value: { readonly title: string; readonly value: string } | null;
  readonly closeLabel: string;
  readonly onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (value) input.current?.select();
  }, [value]);
  return (
    <Dialog
      open={value !== null}
      onClose={onClose}
      title={value?.title ?? ''}
      closeLabel={closeLabel}
      size="sm"
      data-testid="manual-copy-dialog"
    >
      <input
        ref={input}
        readOnly
        dir="ltr"
        aria-label={value?.title ?? ''}
        value={value?.value ?? ''}
        className="min-h-11 w-full rounded-md border border-border-strong bg-surface-sunken px-3 font-mono text-sm"
      />
    </Dialog>
  );
}

export interface ResendExpiredButtonProps {
  /** Expired invitations that can still be resent. */
  readonly ids: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/** The attention strip's «إعادة إرسال الدعوات المنتهية (N)»: resends each expired invitation in turn. */
export function ResendExpiredButton({ ids, labels, errors }: ResendExpiredButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const resendAll = () => {
    startTransition(async () => {
      let sent = 0;
      for (const id of ids) {
        const result = await resendInvitationAction({ invitationId: id });
        if (!result.ok) {
          toast.error(invitationErrorText(result.error, labels, errors));
          break;
        }
        sent += 1;
      }
      if (sent > 0) toast.success((labels.resentExpired ?? '').replace('{count}', String(sent)));
      router.refresh();
    });
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      busy={pending}
      disabled={pending}
      onClick={resendAll}
      data-testid="resend-expired"
    >
      {pending ? labels.working : labels.resendExpired}
    </Button>
  );
}
