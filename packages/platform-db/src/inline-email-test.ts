import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';

/**
 * The test e-mail of the two e-mail settings pages, sent the moment the action commits (WP-ADM-05 follow-up,
 * PO 23 Oct 2026; migration 20261026110100). The web app claims the caller's OWN waiting test inside the
 * action's transaction (the Super Admin's platform sender, or the organization's provider for a member with
 * platform.tenant.manage) under the lease the worker's test task honours, keeps the request's secret, and
 * after the response sends the test through the settings being tested and records the outcome with that
 * secret. The recipient is personal data: never logged.
 */

/** A claimed test (tenantId null: the platform sender): the settings to send it with, sealed. */
export interface InlineEmailTest {
  readonly tenantId: string | null;
  readonly recipient: string;
  readonly version: number;
  readonly provider: string;
  readonly options: unknown;
  readonly credentialsSealed: string;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly replyTo: string | null;
}

export interface InlineEmailTestTicket {
  readonly secret: Buffer;
  readonly test: InlineEmailTest;
}

export type InlineEmailTestScope = 'platform' | 'tenant';

/** In the action's transaction. Null: nothing waiting for this caller (or already claimed). */
export async function claimInlineEmailTest(
  tx: ClaimsTx,
  scope: InlineEmailTestScope,
): Promise<InlineEmailTestTicket | null> {
  const secret = randomBytes(32);
  const hash = createHash('sha256').update(secret).digest();
  const [row] = await tx.execute<{
    tenant_id: string | null;
    recipient: string;
    version: number;
    provider: string;
    options: unknown;
    credentials_sealed: string;
    from_name: string;
    from_address: string;
    reply_to: string | null;
  }>(sql`select * from private.inline_email_test_claim(${scope}, ${hash}::bytea)`);
  if (!row) return null;
  return {
    secret,
    test: {
      tenantId: row.tenant_id,
      recipient: row.recipient,
      version: row.version,
      provider: row.provider,
      options: row.options,
      credentialsSealed: row.credentials_sealed,
      fromName: row.from_name,
      fromAddress: row.from_address,
      replyTo: row.reply_to,
    },
  };
}

export type InlineEmailTestOutcome =
  { readonly sent: true } | { readonly sent: false; readonly errorCode: string };

export interface InlineEmailTestApi {
  /** True when the settings became verified. False also when the test is no longer this request's. */
  finish(secret: Buffer, version: number, outcome: InlineEmailTestOutcome): Promise<boolean>;
}

/** Over a database connected as `app_server`, in a transaction WITHOUT claims: the secret is the credential. */
export function createInlineEmailTestApi(getDb: () => AppDatabase): InlineEmailTestApi {
  return {
    async finish(secret, version, outcome) {
      if (secret.length !== 32) return false;
      const [row] = await runWithClaims(getDb(), '', (tx) =>
        tx.execute<{ verified: boolean }>(sql`
          select private.inline_email_test_finish(${secret}::bytea, ${version}::integer, ${outcome.sent},
                                                  ${outcome.sent ? null : outcome.errorCode}) as verified`),
      );
      return row?.verified === true;
    },
  };
}

export const inlineEmailTestApi = createInlineEmailTestApi(() => getDatabase('app_server'));
