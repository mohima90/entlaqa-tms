import type { Subscriber } from '@jadarat/platform-jobs/jobs';

/**
 * Every event subscriber of the deployment (ADR 0004 §4), registered in code. Platform services and
 * modules add theirs here as they are built (e.g. notifications for invitations, T-M2-06b).
 */
export const SUBSCRIBERS: readonly Subscriber[] = [];
