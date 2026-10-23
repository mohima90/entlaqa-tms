import 'server-only';
/**
 * RESTRICTED ENTRY POINT — the web app's immediate sending only (WP-ADM-05; ADR 0005 §1 amendments of 23 Oct
 * 2026): the Send Email hook's sign-in code, and the messages an action queues in its transaction and sends the
 * moment it has committed (sending/inline-delivery.ts) - both through the sender rule of the worker. Importable
 * only by the adapters of platform-identity (dependency rule `email-sending-code-is-private`).
 */
export {
  type InlineEmailSender,
  createInlineEmailRouter,
  createInlineEmailSender,
} from './sending/inline';
export type { InlineEmailRouter } from './sending/router';
export { type InlineSendResult, sendInlineDelivery } from './sending/inline-delivery';
export { EmailSendError } from './sending/transport';
export { brandAssetUrl } from './brand-asset';
