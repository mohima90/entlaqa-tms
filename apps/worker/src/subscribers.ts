import { createInvitationMailer } from '@jadarat/platform-identity/jobs';
import type { Subscriber, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { type EmailRouter, createEmailSender } from '@jadarat/platform-notifications/jobs';
import { getSystemRole, isSystemRoleCode } from '@jadarat/platform-rbac/system-roles';

export interface SubscriberDependencies {
  /**
   * The sender rule over the settings in the database (WP-ADM-01): the organization's own provider, else the
   * platform sender, else the installation's; nothing ready — messages wait in the queue.
   */
  readonly emailRouter: EmailRouter;
  /**
   * Public origin of the web app for links in e-mails (APP_BASE_URL). Absent: invitations are not mailed
   * (an administrator copies the code or link, or resends once it is set).
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
    createEmailSender({ router: deps.emailRouter, log: deps.log }),
    ...(deps.appBaseUrl === undefined
      ? []
      : [createInvitationMailer({ appBaseUrl: deps.appBaseUrl, roleName, log: deps.log })]),
  ];
}
