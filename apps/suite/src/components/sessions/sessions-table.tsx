'use client';
import { Alert, Badge, Button, Icon, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { endMemberSessionsAction, endMySessionsAction } from '../../actions/security';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';

/**
 * Sign-in sessions (FR-IAM-13, T-M2-10): the member's own on My profile (end one, or all others), and a
 * member's on the user profile for user managers (screen 3: end one, or all — force sign-out). Ending is
 * immediate (the database refuses the session at its next request). Texts and dates come formatted from
 * the server; a browser is described, never shown raw.
 */
export interface SessionRow {
  readonly sessionId: string;
  readonly device: string;
  readonly organization: string | null;
  readonly started: string;
  readonly lastActive: string;
  readonly isCurrent: boolean;
  readonly withCode: boolean;
}

export interface SessionsTableProps {
  readonly target:
    { readonly kind: 'own' } | { readonly kind: 'member'; readonly personId: string };
  readonly sessions: readonly SessionRow[];
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

export function SessionsTable({ target, sessions, labels, errors }: SessionsTableProps) {
  const t = (key: string) => labels[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const others = sessions.filter((s) => !s.isCurrent);

  function end(sessionId: string | null) {
    setMessage(null);
    startTransition(async () => {
      const result =
        target.kind === 'own'
          ? await endMySessionsAction({ sessionId })
          : await endMemberSessionsAction({ personId: target.personId, sessionId });
      if (result.ok) {
        // On My profile a toast (redesign package 6); a user manager's list keeps its inline message.
        if (target.kind === 'own') toast.success(t('ended'));
        else setMessage({ tone: 'success', text: t('ended') });
        router.refresh();
      } else if (!sessionRefused(result.error)) {
        setMessage({ tone: 'danger', text: errorText(result.error, errors) });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid={`sessions-${target.kind}`}>
      {sessions.length === 0 ? (
        <p className="m-0 text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {sessions.map((session) => (
            <li
              key={session.sessionId}
              className={`grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3.5 rounded-xl border px-4 py-3.5 sm:grid-cols-[44px_minmax(0,1fr)_auto] ${
                session.isCurrent
                  ? 'border-primary/40 bg-primary-subtle'
                  : 'border-border bg-surface'
              }`}
              data-testid="session-row"
              data-current={session.isCurrent ? 'true' : undefined}
            >
              <span
                aria-hidden="true"
                className={`grid size-10 place-items-center rounded-[14px] sm:size-11 ${
                  session.isCurrent
                    ? 'bg-brand-gradient text-on-brand'
                    : 'bg-surface-hover text-text-muted'
                }`}
              >
                <Icon name="monitor" className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className="font-semibold">{session.device}</span>
                  {session.isCurrent ? <Badge tone="info">{t('thisDevice')}</Badge> : null}
                  {session.withCode ? <Badge tone="success">{t('withCode')}</Badge> : null}
                </p>
                <p className="m-0 mt-0.5 text-[13.5px] text-text-muted">
                  {target.kind === 'own' ? `${session.organization ?? t('noOrganization')} · ` : ''}
                  {t('started')} {session.started} · {t('lastActive')} {session.lastActive}
                </p>
              </div>
              {session.isCurrent ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="col-start-2 justify-self-start sm:col-start-auto"
                  disabled={pending}
                  aria-label={t('endLabel').replace('{device}', session.device)}
                  onClick={() => {
                    end(session.sessionId);
                  }}
                  data-testid="session-end"
                >
                  {t('end')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {message ? (
        <Alert tone={message.tone} data-testid="sessions-message">
          {message.text}
        </Alert>
      ) : null}
      {others.length > 0 ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              end(null);
            }}
            data-testid="sessions-end-all"
          >
            {pending ? t('ending') : t(target.kind === 'own' ? 'endOthers' : 'endAll')}
          </Button>
          {/* Ending ALL of a member's sessions also forgets their remembered browsers (WP-ADM-05). */}
          {target.kind === 'member' ? (
            <p
              className="m-0 mt-2 text-[13.5px] text-text-muted"
              data-testid="sessions-also-forgets"
            >
              {t('alsoForgets')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
