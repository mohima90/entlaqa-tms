import { type EmailRouteRow, type SystemTx, loadEmailRoute } from '@jadarat/platform-db/jobs';
import type { EmailRoute } from '../sending/transport';
import { type InlineEmailRouter, createSenderRule } from '../sending/router';

export { brandName, type InstallationSender } from '../sending/router';

export interface EmailRouter {
  /**
   * The sender rule for the job's organization, in its transaction (`tenantId`: the job's organization — the
   * organization's sealed secrets are bound to it). Settings that cannot be used make the message WAIT
   * (CREDENTIALS_UNAVAILABLE, logged with its code) — never another sender.
   */
  resolve(
    tx: SystemTx,
    tenantId: string,
    /**
     * `platformOnly`: skip the organization's own provider (mail whose content must not pass through an
     * organization's mail server, e.g. the sign-in code of an account that belongs to several organizations).
     */
    options?: { readonly platformOnly?: boolean },
  ): Promise<EmailRoute>;
  /** Closes the cached transports (worker stop). */
  close(): Promise<void>;
}

/** SQLSTATE undefined_function: the database is not migrated yet. */
const UNDEFINED_FUNCTION = '42883';

function isMissingFunction(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === UNDEFINED_FUNCTION) return true;
  }
  return false;
}

/**
 * The worker's router: the sender rule (sending/router.ts, shared with the web tier's Send Email hook) over the
 * settings it reads in the job's transaction (WP-ADM-01, FR-NTF-11).
 */
export function createEmailRouter(
  options: Parameters<typeof createSenderRule>[0],
): EmailRouter & InlineEmailRouter {
  const rule = createSenderRule(options);
  const { installation } = options;
  return {
    ...rule,
    async resolve(tx, tenantId, resolveOptions) {
      let row: EmailRouteRow | null;
      try {
        row = await tx.transaction((savepoint) => loadEmailRoute(savepoint));
      } catch (error) {
        if (!isMissingFunction(error)) throw error;
        // The database is not migrated yet: the installation's sender (if any), as before.
        return installation
          ? {
              kind: 'send',
              transport: installation.transport,
              from: { name: installation.name, address: installation.address },
              sender: 'installation',
            }
          : { kind: 'wait', code: 'NO_SENDER' };
      }
      return rule.fromRow(row, tenantId, resolveOptions);
    },
  };
}
