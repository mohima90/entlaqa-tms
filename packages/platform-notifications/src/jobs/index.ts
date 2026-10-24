/**
 * RESTRICTED ENTRY POINT — job code and the worker app only (ADR 0005, ADR 0008): queueing e-mail in a
 * job's tenant transaction, the e-mail sender, the sender rule over the settings in the database
 * (WP-ADM-01), the provider adapters, opening sealed provider secrets, and the e-mail platform tasks.
 */
export { type EmailSettings, readEmailSettings } from '../sending/config';
export {
  CredentialsError,
  type CredentialsKeyPair,
  EMAIL_CREDENTIALS_KEY_ENV,
  EMAIL_CREDENTIALS_KEY_MIN_LENGTH,
  deriveCredentialsKeyPair,
} from '../sending/credentials';
export {
  EMAIL_HOUSEKEEPING_TASK,
  EMAIL_INLINE_RESCUE_TASK,
  EMAIL_RESUME_TASK,
  EMAIL_TESTS_TASK,
  createEmailHousekeepingTask,
  createEmailInlineRescueTask,
  createEmailResumeTask,
  createEmailTestTask,
} from './email-tasks';
export { createProviderTransport } from '../sending/factory';
export { createMailgunTransport, MAILGUN_API_ORIGINS } from '../sending/mailgun';
export {
  MICROSOFT_GRAPH_ORIGIN,
  MICROSOFT_LOGIN_ORIGIN,
  createMicrosoftGraphTransport,
} from '../sending/microsoft-graph';
export { type EmailRequest, queueEmail } from './queue';
export { RESEND_API_URL, createResendTransport, formatFrom } from '../sending/resend';
export { type EmailRouter, type InstallationSender, brandName, createEmailRouter } from './router';
export {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_QUEUED_EVENT,
  EMAIL_SENDER_NAME,
  createEmailSender,
} from './sender';
export { SENDGRID_API_URL, createSendGridTransport } from '../sending/sendgrid';
export {
  type HostLookup,
  SMTP_SEND_DEADLINE_MS,
  SUBMISSION_SMTP_PORTS,
  type SmtpSettings,
  classifySmtpError,
  createSmtpTransport,
  isPublicAddress,
  parseSmtpUrl,
} from '../sending/smtp';
export { sendTestEmail } from './test-email';
export {
  EmailSendError,
  type EmailRoute,
  type EmailSenderKind,
  type EmailTransport,
  type OutgoingEmail,
} from '../sending/transport';
