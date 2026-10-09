'use client';
import { Alert, Badge, Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { endMemberSessionsAction, endMySessionsAction } from '../../actions/security';
import { type ErrorTexts, errorText } from '../auth/error-text';

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
        setMessage({ tone: 'success', text: t('ended') });
        router.refresh();
      } else {
        setMessage({ tone: 'danger', text: errorText(result.error, errors) });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid={`sessions-${target.kind}`}>
      {sessions.length === 0 ? (
        <p className="m-0 text-text-muted">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-start">
            <thead>
              <tr className="border-b border-border text-sm text-text-muted">
                <th scope="col" className="py-2 pe-4 text-start font-medium">
                  {t('device')}
                </th>
                {target.kind === 'own' ? (
                  <th scope="col" className="py-2 pe-4 text-start font-medium">
                    {t('organization')}
                  </th>
                ) : null}
                <th scope="col" className="py-2 pe-4 text-start font-medium">
                  {t('started')}
                </th>
                <th scope="col" className="py-2 pe-4 text-start font-medium">
                  {t('lastActive')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  <span className="sr-only">{t('action')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr
                  key={session.sessionId}
                  className="border-b border-border last:border-b-0"
                  data-testid="session-row"
                  data-current={session.isCurrent ? 'true' : undefined}
                >
                  <td className="py-3 pe-4">
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{session.device}</span>
                      {session.isCurrent ? <Badge tone="info">{t('thisDevice')}</Badge> : null}
                      {session.withCode ? <Badge tone="success">{t('withCode')}</Badge> : null}
                    </span>
                  </td>
                  {target.kind === 'own' ? (
                    <td className="py-3 pe-4">{session.organization ?? t('noOrganization')}</td>
                  ) : null}
                  <td className="py-3 pe-4">{session.started}</td>
                  <td className="py-3 pe-4">{session.lastActive}</td>
                  <td className="py-3">
                    {session.isCurrent ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        </div>
      ) : null}
    </div>
  );
}
