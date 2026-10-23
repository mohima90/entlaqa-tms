/**
 * RESTRICTED ENTRY POINT — the Send Email hook route of the web app only (WP-ADM-05; ADR 0005 §1 amendment of
 * 23 Oct 2026): sending the one-time sign-in code at once, through the sender rule of the worker.
 */
export {
  type InlineEmailSender,
  createInlineEmailRouter,
  createInlineEmailSender,
} from './sending/inline';
export { EmailSendError } from './sending/transport';
export { brandAssetUrl } from './brand-asset';
