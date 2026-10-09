export { isEmailAddress, maskEmailAddress } from './address';
export { formatEmailDate } from './format';
export { escapeHtml, isSafeLink } from './html';
export { InvitationVariables, invitationTemplate } from './templates/invitation';
export { PasswordChangedVariables, passwordChangedTemplate } from './templates/password-changed';
export { PasswordResetVariables, passwordResetTemplate } from './templates/password-reset';
export {
  EMAIL_TEMPLATES,
  type EmailTemplateKey,
  type EmailVariables,
  renderEmail,
} from './templates/index';
export type { EmailTemplate, RenderedEmail } from './templates/types';
