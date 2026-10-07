'use server';
/**
 * My profile (FR-IAM-16): the member's own personal details and password. Definitions and tests in
 * @jadarat/platform-rbac (iam/my-profile.ts); the password flow in @jadarat/platform-identity.
 */
import {
  changePasswordForRequest,
  queueOwnPasswordChangedNoticeForRequest,
} from '@jadarat/platform-identity/auth';
import {
  changeMyPasswordActionDefinition,
  defineAction,
  updateMyProfileActionDefinition,
} from '@jadarat/platform-rbac';

export const updateMyProfileAction = defineAction(updateMyProfileActionDefinition());

// After a successful change: the "password changed" notice through our notification service when
// PASSWORD_RESET_DELIVERY=worker (T-M2-17); never fails the change.
export const changeMyPasswordAction = defineAction(
  changeMyPasswordActionDefinition(
    changePasswordForRequest,
    queueOwnPasswordChangedNoticeForRequest,
  ),
);
