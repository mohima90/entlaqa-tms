import { createInvitationMailer } from '@jadarat/platform-identity/jobs';
import type { Subscriber, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { type EmailTransport, createEmailSender } from '@jadarat/platform-notifications/jobs';
import { getSystemRole, isSystemRoleCode } from '@jadarat/platform-rbac/system-roles';

export interface SubscriberDependencies {
  /** null: e-mail switched off (queued messages are recorded as suppressed). */
  readonly emailTransport: EmailTransport | null;
  readonly emailFrom: { readonly name: string; readonly address: string };
  /**
   * Public origin of the web app for links in e-mails (APP_BASE_URL). Absent only while e-mail is
   * switched off: invitations are then not mailed (an administrator resends them once it is on).
   */
  readonly appBaseUrl: string | undefined;
  readonly log: (level: WorkerLogLevel, message: string) => void;
}

/** Arabic and English name of a system role; the database refers to existing roles only. */
function roleName(code: string): { ar: string; en: string } {
  if (!isSystemRoleCode(code)) throw new Error('invitation mailer: unknown system role');
  return getSystemRole(code).name;
}

/**
 * Every event subscriber of the deployment (ADR 0004 §4), registered in code. Platform services and
 * modules add theirs here as they are built.
 */
export function subscribers(deps: SubscriberDependencies): readonly Subscriber[] {
  return [
    createEmailSender({ transport: deps.emailTransport, from: deps.emailFrom, log: deps.log }),
    ...(deps.appBaseUrl === undefined
      ? []
      : [createInvitationMailer({ appBaseUrl: deps.appBaseUrl, roleName, log: deps.log })]),
  ];
}
