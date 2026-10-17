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
export {
  EMAIL_ERROR_CODES,
  EMAIL_PROVIDERS,
  EMAIL_PROVIDER_OPTIONS,
  EMAIL_PROVIDER_SECRETS,
  EmailAddress,
  type EmailErrorCode,
  EmailProviderInput,
  type EmailProviderId,
  type EmailProviderOptions,
  type EmailProviderSecrets,
  SenderName,
  isEmailProvider,
  isKnownEmailErrorCode,
} from './providers';
export {
  type CredentialsPublicKey,
  type CredentialsScope,
  credentialsContext,
  credentialsKeyId,
  sealCredentials,
  sealProviderInput,
  sealedKeyId,
} from './credentials-seal';
export { EmailTestVariables, emailTestTemplate } from './templates/email-test';
