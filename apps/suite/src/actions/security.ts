'use server';
/**
 * Security settings (screen 6) — FR-IAM-12/13, T-M2-10. Definitions and tests in
 * @jadarat/platform-rbac (iam/security.ts); the database enforces the rules.
 */
import { defineAction, updateSecurityPolicyActionDefinition } from '@jadarat/platform-rbac';

/** Organization Admin at AAL2 only (high risk: getUser + authenticator code). */
export const updateSecurityPolicyAction = defineAction(updateSecurityPolicyActionDefinition());
