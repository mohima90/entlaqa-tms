'use server';
/**
 * My profile (FR-IAM-16): the member's own personal details and password. Definitions and tests in
 * @jadarat/platform-rbac (iam/my-profile.ts); the password flow in @jadarat/platform-identity.
 */
import { changePasswordForRequest } from '@jadarat/platform-identity/auth';
import {
  changeMyPasswordActionDefinition,
  defineAction,
  updateMyProfileActionDefinition,
} from '@jadarat/platform-rbac';

export const updateMyProfileAction = defineAction(updateMyProfileActionDefinition());

export const changeMyPasswordAction = defineAction(
  changeMyPasswordActionDefinition(changePasswordForRequest),
);
