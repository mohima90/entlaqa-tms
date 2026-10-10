import 'server-only';
import { PLATFORM_RESPONSIBILITIES, type ResponsibilityKind } from '@jadarat/platform-rbac';

/**
 * What a member may be responsible for, to be handed over before they are deactivated (T-M2-09,
 * FR-IAM-05; the reassignment hook in platform-rbac `iam/deactivation.ts`). Modules add their kinds here
 * as they ship (M3: upcoming sessions; M4: pending approvals, logistics tasks), each with the message
 * keys `deactivation.items.<code with "." → "_">.title` and `….picker`. The deactivation page and action
 * must use the same list.
 */
export const RESPONSIBILITY_KINDS: readonly ResponsibilityKind[] = [...PLATFORM_RESPONSIBILITIES];
