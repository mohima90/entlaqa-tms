'use server';
/**
 * "Stay signed in" on the inactivity warning (screen 6, T-M2-10): the request itself records the
 * session's activity in the database (withUserTx → private.touch_session). Definition in
 * @jadarat/platform-rbac (iam/security.ts).
 */
import { defineAction, keepSessionAliveActionDefinition } from '@jadarat/platform-rbac';

export const keepSessionAliveAction = defineAction(keepSessionAliveActionDefinition());
