import { emitEvent } from '@jadarat/platform-db';
import { type SystemTx, getEmailBrand, insertEmailDelivery } from '@jadarat/platform-db/jobs';
import type { AppLocale } from '@jadarat/platform-i18n';
import { isEmailAddress, maskEmailAddress } from '../address';
import { type EmailTemplateKey, type EmailVariables, renderEmail } from '../templates/index';
import { EMAIL_QUEUED_EVENT } from './sender';

export interface EmailRequest<K extends EmailTemplateKey> {
  readonly template: K;
  /** Primary language (the recipient's, or the one chosen for an invitation); both are included. */
  readonly locale: AppLocale;
  readonly to: string;
  readonly variables: EmailVariables<K>;
  readonly recipientPersonId?: string | null;
  /** The event this message answers. */
  readonly sourceEventId?: string | null;
  /**
   * Public origin of the web app (APP_BASE_URL): the organization's logo is linked from there
   * (/api/brand/<id>, WP-ADM-02). Absent: no logo (the colours still apply).
   */
  readonly appBaseUrl?: string | undefined;
}

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The address of a published branding image for e-mail clients (they fetch it without a session). */
export function brandAssetUrl(
  appBaseUrl: string | undefined,
  assetId: string | null,
): string | null {
  if (!appBaseUrl || !assetId || !ASSET_ID.test(assetId)) return null;
  return `${appBaseUrl.replace(/\/+$/, '')}/api/brand/${assetId}`;
}

/**
 * Queues an e-mail in the job's tenant transaction (ADR 0008 §1): renders it (with the organization's look,
 * WP-ADM-02), records the delivery and
 * emits `com.entlaqa.platform.email.queued`, so the send happens after commit, in its own job. Called by
 * notification subscribers (transactional kind), never by request code.
 */
export async function queueEmail<K extends EmailTemplateKey>(
  tx: SystemTx,
  request: EmailRequest<K>,
): Promise<string> {
  if (!isEmailAddress(request.to)) throw new Error('queueEmail: invalid recipient address');
  // The organization's look (FR-NTF-02), read in the job's tenant transaction (none: Jadarat's).
  const brand = await getEmailBrand(tx);
  const rendered = renderEmail(
    request.template,
    request.locale,
    request.variables,
    brand
      ? {
          actionColor: brand.actionColor,
          linkColor: brand.linkColor,
          logoUrl: brandAssetUrl(request.appBaseUrl, brand.logoAssetId),
        }
      : null,
  );
  const id = await insertEmailDelivery(tx, {
    template: request.template,
    templateVersion: rendered.version,
    locale: request.locale,
    recipientPersonId: request.recipientPersonId ?? null,
    destination: request.to,
    destinationMasked: maskEmailAddress(request.to),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    sourceEventId: request.sourceEventId ?? null,
  });
  await emitEvent(tx, {
    type: EMAIL_QUEUED_EVENT,
    subject: id,
    data: { template: request.template },
  });
  return id;
}
