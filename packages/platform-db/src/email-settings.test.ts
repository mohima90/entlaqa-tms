import { describe, expect, it, vi } from 'vitest';
import type { ClaimsTx } from './claims-tx';
import {
  EmailSettingsError,
  emailSettingsErrorOf,
  getEmailCredentialsPublicKey,
  getPlatformEmailSettings,
  getTenantEmailSettings,
  listTenantEmailFailures,
} from './email-settings';

vi.mock('server-only', () => ({}));

const pg = (code: string, message = 'x') => Object.assign(new Error(message), { code });

/** A transaction whose savepoint answers `rows`, or fails with `error`. */
function txWith(result: { rows?: unknown[]; error?: Error }): ClaimsTx {
  const tx = {
    execute: vi.fn(() =>
      result.error ? Promise.reject(result.error) : Promise.resolve(result.rows ?? []),
    ),
    transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
  return tx as unknown as ClaimsTx;
}

describe('e-mail settings (WP-ADM-01): the database refusals', () => {
  it('maps the SQLSTATEs of the definer functions to stable codes with the field', () => {
    expect(emailSettingsErrorOf(pg('42501'))).toMatchObject({ code: 'EMAIL_SETTINGS_FORBIDDEN' });
    expect(emailSettingsErrorOf(pg('JE001', 'from_address'))).toMatchObject({
      code: 'EMAIL_SETTINGS_INVALID',
      field: 'from_address',
    });
    expect(emailSettingsErrorOf(pg('JE001', 'something else'))).toMatchObject({ field: null });
    expect(emailSettingsErrorOf(pg('JE002'))).toMatchObject({ code: 'EMAIL_SETTINGS_CONFLICT' });
    expect(emailSettingsErrorOf(pg('JE003'))).toMatchObject({ code: 'EMAIL_SETTINGS_KEY_CHANGED' });
    expect(emailSettingsErrorOf(pg('JE004'))).toMatchObject({
      code: 'EMAIL_SETTINGS_NOT_VERIFIED',
    });
    expect(emailSettingsErrorOf(pg('JE005'))).toMatchObject({
      code: 'EMAIL_SETTINGS_NOT_CONFIGURED',
    });
    const other = pg('23505');
    expect(emailSettingsErrorOf(other)).toBe(other);
    expect(new EmailSettingsError('EMAIL_SETTINGS_FORBIDDEN').message).toBe(
      'EMAIL_SETTINGS_FORBIDDEN',
    );
  });

  it('before the migration the pages read "not set up" (the app deploys first)', async () => {
    const missing = txWith({ error: pg('42883') });
    expect(await getEmailCredentialsPublicKey(missing)).toBeNull();
    expect(await getPlatformEmailSettings(missing)).toMatchObject({
      available: false,
      keyReady: false,
    });
    expect(await getTenantEmailSettings(missing)).toMatchObject({ available: false });
    expect(await listTenantEmailFailures(missing)).toEqual([]);
    await expect(getPlatformEmailSettings(txWith({ error: pg('42501') }))).rejects.toMatchObject({
      code: 'EMAIL_SETTINGS_FORBIDDEN',
    });
  });

  it('a sender sealed with an older key reads as "enter the secrets again"', async () => {
    const view = await getTenantEmailSettings(
      txWith({
        rows: [
          {
            configured: true,
            provider: 'smtp',
            options: { host: 'smtp.x.example' },
            credentials_key_id: 'oldKey000001',
            current_key_id: 'newKey000001',
            from_name: 'A',
            from_address: 'a@x.example',
            reply_to: null,
            enabled: false,
            status: 'unverified',
            verified_at: null,
            version: 2,
            updated_at: '2026-10-22T10:00:00Z',
            test_status: 'failed',
            test_recipient_masked: 'i***@x.example',
            test_error_code: 'CREDENTIALS_KEY_CHANGED',
            test_requested_at: '2026-10-22T10:00:00Z',
            test_finished_at: '2026-10-22T10:05:00Z',
            platform_sender_verified: true,
            waiting_count: '4',
          },
        ],
      }),
    );
    expect(view).toMatchObject({
      available: true,
      keyReady: true,
      platformSenderVerified: true,
      waitingCount: 4,
      sender: {
        provider: 'smtp',
        credentialsCurrent: false,
        test: {
          status: 'failed',
          errorCode: 'CREDENTIALS_KEY_CHANGED',
          recipientMasked: 'i***@x.example',
        },
      },
    });
  });
});
