export { isEmailAddress, maskEmailAddress } from './address';
export { formatEmailDate } from './format';
export { escapeHtml, isSafeLink } from './html';
export { InvitationVariables, invitationTemplate } from './templates/invitation';
export { PasswordChangedVariables, passwordChangedTemplate } from './templates/password-changed';
export { PasswordResetVariables, passwordResetTemplate } from './templates/password-reset';
export { MfaFactorAddedVariables, mfaFactorAddedTemplate } from './templates/mfa-factor-added';
export {
  MFA_REMOVAL_REASONS,
  MfaFactorRemovedVariables,
  mfaFactorRemovedTemplate,
} from './templates/mfa-factor-removed';
export {
  SECURITY_SETTING_NAMES,
  SecurityPolicyChangedVariables,
  securityPolicyChangedTemplate,
} from './templates/security-policy-changed';
export {
  DIGEST_KINDS,
  SecurityDigestVariables,
  securityDigestTemplate,
} from './templates/security-digest';
export {
  EMAIL_TEMPLATES,
  type EmailTemplateKey,
  type EmailVariables,
  renderEmail,
} from './templates/index';
export type { EmailTemplate, RenderedEmail } from './templates/types';
