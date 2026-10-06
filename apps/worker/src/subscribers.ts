import type { Subscriber, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { type EmailTransport, createEmailSender } from '@jadarat/platform-notifications/jobs';

export interface SubscriberDependencies {
  /** null: e-mail switched off (queued messages are recorded as suppressed). */
  readonly emailTransport: EmailTransport | null;
  readonly emailFrom: { readonly name: string; readonly address: string };
  readonly log: (level: WorkerLogLevel, message: string) => void;
}

/**
 * Every event subscriber of the deployment (ADR 0004 §4), registered in code. Platform services and
 * modules add theirs here as they are built (invitations, T-M2-07).
 */
export function subscribers(deps: SubscriberDependencies): readonly Subscriber[] {
  return [
    createEmailSender({ transport: deps.emailTransport, from: deps.emailFrom, log: deps.log }),
  ];
}
