import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  EmailSettingsError,
  type TenantEmailFailure,
  type TenantEmailView,
  type UserTx,
  getEmailCredentialsPublicKey,
  getTenantEmailSettings,
  listTenantEmailFailures,
  requestTenantEmailTest,
  saveTenantEmailSettings,
  setTenantEmailEnabled,
} from '@jadarat/platform-db';
import {
  EmailAddress,
  type EmailProviderId,
  EmailProviderInput,
  type CredentialsScope,
  SenderName,
  sealProviderInput,
} from '@jadarat/platform-notifications';
import { z } from 'zod';
import type { ActionDefinition } from '../define-action';
import type { QueryDefinition } from '../define-query';
import { platformPermissions as p } from '../platform-permissions';

/**
 * Settings → Email integration (WP-ADM-01; FR-NTF-11, FR-NTF-02 sending; Kawadir's org settings → Email; flow
 * docs/business-flows/EP-EMAIL-email-sending.md, agreed 17 Oct 2026). The organization sends through the
 * platform sender by default, or through its own provider (Resend, SMTP, SendGrid, Mailgun, Microsoft 365)
 * once it is configured, tested and enabled; it can switch back at any time. No automatic fallback: its
 * provider's delivery errors are shown here as its own.
 *
 *   - The page: members who read the organization's settings (`platform.tenant.read`; the Organization Admin
 *     changes them with `platform.tenant.manage`) — never the secrets (write-only).
 *   - Saving, testing and switching: `platform.tenant.manage` (high risk: the session is confirmed with
 *     Auth). The secrets are sealed HERE, on the server, with the worker's public key and bound to this
 *     organization and provider — the web app can never open them again. Audited: which fields changed and
 *     the provider — never a secret, never an address.
 *   - The database enforces who may do what and every rule (private.save_tenant_email_settings…).
 */

export const TenantEmailSettingsInput = z.strictObject({
  /** The version the page showed; null when nothing was saved yet. */
  version: z.int().min(1).nullable(),
  provider: EmailProviderInput,
  fromName: SenderName,
  fromAddress: EmailAddress,
  /** Empty: no reply-to. */
  replyTo: z.union([z.literal(''), EmailAddress]),
});

export const TenantEmailTestInput = z.strictObject({ recipient: EmailAddress });

export const TenantEmailEnabledInput = z.strictObject({
  enabled: z.boolean(),
  version: z.int().min(1),
});

export interface EmailIntegrationPageView {
  readonly settings: TenantEmailView;
  readonly failures: readonly TenantEmailFailure[];
  /** allowed (Organization Admin) · denied (read only). */
  readonly editAccess: 'allowed' | 'denied';
}

/** The database's refusals as the action's answer; anything else is thrown (an internal error). */
export function emailSettingsRefusal(error: unknown): { ok: false; error: AppError } {
  if (!(error instanceof EmailSettingsError)) throw error;
  switch (error.code) {
    case 'EMAIL_SETTINGS_FORBIDDEN':
      return err(appError('FORBIDDEN'));
    case 'EMAIL_SETTINGS_CONFLICT':
      return err(appError('CONFLICT_VERSION'));
    case 'EMAIL_SETTINGS_INVALID':
      return err(
        appError('VALIDATION_FAILED', {
          fieldErrors: [{ path: FIELD_PATHS[error.field ?? 'options'], code: 'INVALID' }],
        }),
      );
    case 'EMAIL_SETTINGS_KEY_CHANGED':
      return err(
        appError('VALIDATION_FAILED', { fieldErrors: [{ path: 'form', code: 'KEY_CHANGED' }] }),
      );
    case 'EMAIL_SETTINGS_NOT_VERIFIED':
      return err(
        appError('VALIDATION_FAILED', { fieldErrors: [{ path: 'enabled', code: 'NOT_VERIFIED' }] }),
      );
    case 'EMAIL_SETTINGS_NOT_CONFIGURED':
      return err(
        appError('VALIDATION_FAILED', { fieldErrors: [{ path: 'form', code: 'NOT_CONFIGURED' }] }),
      );
  }
}

const FIELD_PATHS = {
  provider: 'provider',
  options: 'options',
  credentials: 'secrets',
  from_name: 'fromName',
  from_address: 'fromAddress',
  reply_to: 'replyTo',
  test_to: 'recipient',
  enabled: 'enabled',
} as const;

/**
 * Seals the secrets typed on a settings page for the worker (null: keep the saved ones). Refuses when no
 * worker has published its key yet (e-mail sending not set up): nothing is saved then.
 */
export async function sealProviderSecrets(
  tx: UserTx,
  scope: CredentialsScope,
  provider: EmailProviderInput,
): Promise<{ ok: true; sealed: string | null } | { ok: false; error: AppError }> {
  if (provider.secrets === null) return { ok: true, sealed: null };
  const key = await getEmailCredentialsPublicKey(tx);
  if (!key) {
    return err(
      appError('VALIDATION_FAILED', { fieldErrors: [{ path: 'form', code: 'NOT_SET_UP' }] }),
    );
  }
  return { ok: true, sealed: sealProviderInput(key, scope, provider) };
}

export function emailIntegrationQueryDefinition(): QueryDefinition<
  z.ZodObject<Record<string, never>>,
  EmailIntegrationPageView,
  UserTx
> {
  return {
    permission: p['platform.tenant.read'],
    input: z.strictObject({}),
    handler: async ({ ctx }) => {
      try {
        const settings = await getTenantEmailSettings(ctx.tx);
        const failures = settings.available ? await listTenantEmailFailures(ctx.tx, 20) : [];
        const editAccess = ctx.can(p['platform.tenant.manage'], 'tenant') ? 'allowed' : 'denied';
        return ok({ settings, failures, editAccess });
      } catch (error) {
        return emailSettingsRefusal(error);
      }
    },
  };
}

export interface TenantEmailSaved {
  readonly tenantId: string;
  readonly version: number;
  readonly provider: EmailProviderId;
  readonly changed: readonly string[];
  readonly reverify: boolean;
}

export function saveTenantEmailSettingsActionDefinition(): ActionDefinition<
  typeof TenantEmailSettingsInput,
  TenantEmailSaved,
  UserTx
> {
  return {
    permission: p['platform.tenant.manage'],
    input: TenantEmailSettingsInput,
    handler: async ({ ctx, input }) => {
      const tenantId = ctx.claims.tenant_id;
      const sealed = await sealProviderSecrets(
        ctx.tx,
        { kind: 'tenant', tenantId },
        input.provider,
      );
      if (!sealed.ok) return sealed;
      try {
        const saved = await saveTenantEmailSettings(ctx.tx, {
          provider: input.provider.provider,
          options: input.provider.options,
          credentialsSealed: sealed.sealed,
          fromName: input.fromName,
          fromAddress: input.fromAddress,
          replyTo: input.replyTo === '' ? null : input.replyTo,
          version: input.version,
        });
        return ok({ tenantId, provider: input.provider.provider, ...saved });
      } catch (error) {
        return emailSettingsRefusal(error);
      }
    },
    // What changed and the provider — never a secret or an address (WP-ADM-01).
    audit: (_input, output) =>
      output.changed.length === 0
        ? null
        : {
            action: 'platform.email.integration_changed',
            entityType: 'tenant_email_settings',
            entityId: output.tenantId,
            data: {
              provider: output.provider,
              changed: output.changed,
              version: output.version,
              needsTest: output.reverify,
            },
          },
  };
}

export function requestTenantEmailTestActionDefinition(): ActionDefinition<
  typeof TenantEmailTestInput,
  { readonly tenantId: string; readonly provider: string },
  UserTx
> {
  return {
    permission: p['platform.tenant.manage'],
    input: TenantEmailTestInput,
    handler: async ({ ctx, input }) => {
      try {
        const provider = await requestTenantEmailTest(ctx.tx, input.recipient);
        return ok({ tenantId: ctx.claims.tenant_id, provider });
      } catch (error) {
        return emailSettingsRefusal(error);
      }
    },
    audit: (_input, output) => ({
      action: 'platform.email.integration_test_requested',
      entityType: 'tenant_email_settings',
      entityId: output.tenantId,
      data: { provider: output.provider },
    }),
  };
}

export function setTenantEmailEnabledActionDefinition(): ActionDefinition<
  typeof TenantEmailEnabledInput,
  {
    readonly tenantId: string;
    readonly version: number;
    readonly enabled: boolean;
    readonly changed: boolean;
  },
  UserTx
> {
  return {
    permission: p['platform.tenant.manage'],
    input: TenantEmailEnabledInput,
    handler: async ({ ctx, input }) => {
      try {
        const version = await setTenantEmailEnabled(ctx.tx, input.enabled, input.version);
        return ok({
          tenantId: ctx.claims.tenant_id,
          version,
          enabled: input.enabled,
          changed: version !== input.version,
        });
      } catch (error) {
        return emailSettingsRefusal(error);
      }
    },
    audit: (_input, output) =>
      output.changed
        ? {
            action: output.enabled
              ? 'platform.email.integration_enabled'
              : 'platform.email.integration_disabled',
            entityType: 'tenant_email_settings',
            entityId: output.tenantId,
            data: { version: output.version },
          }
        : null,
  };
}
