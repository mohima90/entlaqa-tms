/**
 * RESTRICTED ENTRY POINT — job code and the worker app only (ADR 0005, ADR 0008): queueing e-mail in a
 * job's tenant transaction, the e-mail sender and its provider adapters.
 */
export { type EmailSettings, readEmailSettings } from './config';
export { type EmailRequest, queueEmail } from './queue';
export { RESEND_API_URL, createResendTransport, formatFrom } from './resend';
export {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_QUEUED_EVENT,
  EMAIL_SENDER_NAME,
  createEmailSender,
} from './sender';
export { type SmtpSettings, classifySmtpError, createSmtpTransport, parseSmtpUrl } from './smtp';
export { sendTestEmail } from './test-email';
export {
  EmailSendError,
  type EmailRoute,
  type EmailRouter,
  type EmailTransport,
  type OutgoingEmail,
} from './transport';
