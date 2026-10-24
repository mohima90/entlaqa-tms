import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { credentialsContext, sealedKeyId } from '@jadarat/platform-notifications';
// Test only: the worker's side, to prove what the web app sealed opens there (and nowhere else).
import { deriveCredentialsKeyPair } from '@jadarat/platform-notifications/jobs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Grant } from '../authorize';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { MEMBER_GRANTS } from '../member-permissions';
import { type TestRoleCode, testRoleGrants } from '../testing/former-roles';
import {
  emailIntegrationQueryDefinition,
  requestTenantEmailTestActionDefinition,
  saveTenantEmailSettingsActionDefinition,
  setTenantEmailEnabledActionDefinition,
} from './email-integration';

class FakeEmailSettingsError extends Error {
  constructor(
    readonly code: string,
    readonly field: string | null = null,
  ) {
    super(code);
  }
}
const db = vi.hoisted(() => ({
  EmailSettingsError: class extends Error {},
  getEmailCredentialsPublicKey: vi.fn(),
  getTenantEmailSettings: vi.fn(),
  listTenantEmailFailures: vi.fn(),
  saveTenantEmailSettings: vi.fn(),
  requestTenantEmailTest: vi.fn(),
  setTenantEmailEnabled: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);
// The refusals the database helpers throw are EmailSettingsErrors.
db.EmailSettingsError = FakeEmailSettingsError as unknown as typeof db.EmailSettingsError;

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const KEYS = deriveCredentialsKeyPair(
  'a-generated-64-character-secret-for-the-rbac-tests-0123456789ab',
);

function runtime(grants: readonly Grant[]) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const getClaims = vi.fn(() => {
    const r = brandVerifiedClaims({
      sub: '11111111-1111-4111-8111-111111111111',
      role: 'authenticated',
      aal: 'aal1',
      session_id: '55555555-5555-4555-8555-555555555555',
      tenant_id: TENANT,
      person_id: '33333333-3333-4333-8333-333333333333',
    });
    if (!r.ok) throw new Error('fixture');
    return Promise.resolve(ok(r.value));
  });
  const rt: ActionRuntime<UserTx> = {
    getClaims,
    withUserTx: (_c, fn) => fn(TX),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: false }),
    loadGrants: () => Promise.resolve([...grants, ...MEMBER_GRANTS]),
    resolveResource: () => Promise.resolve(null),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit, getClaims };
}
const forRoles = (...roles: TestRoleCode[]) => testRoleGrants(roles, []);

const VIEW = {
  available: true,
  keyReady: true,
  sender: null,
  platformSenderVerified: true,
  waitingCount: 0,
};
const SAVE = {
  version: null,
  provider: {
    provider: 'sendgrid' as const,
    options: {},
    secrets: { apiKey: 'SG.xxxxxxxx.xxxxxxxx' },
  },
  fromName: 'Al Raya Training',
  fromAddress: 'training@raya.example',
  replyTo: 'hr@raya.example',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.getEmailCredentialsPublicKey.mockResolvedValue(KEYS.publicKey);
  db.getTenantEmailSettings.mockResolvedValue(VIEW);
  db.listTenantEmailFailures.mockResolvedValue([]);
  db.saveTenantEmailSettings.mockResolvedValue({
    version: 1,
    changed: ['provider', 'credentials'],
    reverify: true,
  });
  db.requestTenantEmailTest.mockResolvedValue('sendgrid');
  db.setTenantEmailEnabled.mockResolvedValue(2);
});

describe('Email integration page (WP-ADM-01)', () => {
  it('the Organization Admin opens it to edit; read-only for a tenant.read holder', async () => {
    const admin = createDefineQuery(runtime(forRoles('tenant_admin')).rt)(
      emailIntegrationQueryDefinition(),
    );
    expect(await admin({})).toEqual({
      ok: true,
      value: { settings: VIEW, failures: [], editAccess: 'allowed' },
    });
    const auditor = createDefineQuery(runtime(forRoles('auditor')).rt)(
      emailIntegrationQueryDefinition(),
    );
    expect(await auditor({})).toMatchObject({ ok: true, value: { editAccess: 'denied' } });
  });

  it.each([['hr_manager'], ['learner'], ['training_manager']] as const)(
    'refuses the %s (deny by default)',
    async (role) => {
      const result = await createDefineQuery(runtime(forRoles(role)).rt)(
        emailIntegrationQueryDefinition(),
      )({});
      expect(!result.ok && result.error.code).toBe('FORBIDDEN');
      expect(db.getTenantEmailSettings).not.toHaveBeenCalled();
    },
  );
});

describe('saving the organization provider', () => {
  it('seals the secrets on the server for the worker, bound to this organization; audits without secrets or addresses', async () => {
    const { rt, writeAudit, getClaims } = runtime(forRoles('tenant_admin'));
    const result = await createDefineAction(rt)(saveTenantEmailSettingsActionDefinition())(SAVE);
    expect(result).toEqual({
      ok: true,
      value: {
        tenantId: TENANT,
        provider: 'sendgrid',
        version: 1,
        changed: ['provider', 'credentials'],
        reverify: true,
      },
    });
    expect(getClaims).toHaveBeenCalledWith({ strict: true });
    const [, sent] = db.saveTenantEmailSettings.mock.calls[0] as [
      unknown,
      { credentialsSealed: string; replyTo: string },
    ];
    expect(sealedKeyId(sent.credentialsSealed)).toBe(KEYS.publicKey.keyId);
    expect(sent.credentialsSealed).not.toContain('SG.abcdefghij');
    // Only the worker (the private key) opens it — and only for this organization and provider.
    expect(
      KEYS.open(
        sent.credentialsSealed,
        credentialsContext({ kind: 'tenant', tenantId: TENANT }, 'sendgrid'),
      ),
    ).toEqual({
      apiKey: 'SG.xxxxxxxx.xxxxxxxx',
    });
    expect(sent.replyTo).toBe('hr@raya.example');
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.email.integration_changed',
      entityType: 'tenant_email_settings',
      entityId: TENANT,
      data: {
        provider: 'sendgrid',
        changed: ['provider', 'credentials'],
        version: 1,
        needsTest: true,
      },
    });
    const audited = JSON.stringify(writeAudit.mock.calls);
    expect(audited).not.toMatch(/SG\.|@raya\.example|v1\./);
  });

  it('keeps the saved secrets when left empty; refuses when e-mail sending is not set up (no worker key)', async () => {
    const { rt } = runtime(forRoles('tenant_admin'));
    const save = createDefineAction(rt)(saveTenantEmailSettingsActionDefinition());
    await save({ ...SAVE, version: 1, replyTo: '', provider: { ...SAVE.provider, secrets: null } });
    expect(db.saveTenantEmailSettings).toHaveBeenLastCalledWith(
      TX,
      expect.objectContaining({ credentialsSealed: null, replyTo: null, version: 1 }),
    );
    db.getEmailCredentialsPublicKey.mockResolvedValue(null);
    expect(await save(SAVE)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: [{ path: 'form', code: 'NOT_SET_UP' }] },
    });
  });

  it('validates every provider field and refuses unknown fields or providers', async () => {
    const { rt } = runtime(forRoles('tenant_admin'));
    const save = createDefineAction(rt)(saveTenantEmailSettingsActionDefinition());
    for (const bad of [
      { ...SAVE, provider: { provider: 'postmark', options: {}, secrets: null } },
      { ...SAVE, provider: { provider: 'resend', options: {}, secrets: { apiKey: 'sk_live_x' } } },
      {
        ...SAVE,
        provider: {
          provider: 'smtp',
          options: { host: 'smtp.x.example', port: 587, security: 'none', username: '' },
          secrets: null,
        },
      },
      {
        ...SAVE,
        provider: {
          provider: 'mailgun',
          options: { domain: 'mg.x.example', region: 'asia' },
          secrets: null,
        },
      },
      {
        ...SAVE,
        provider: {
          provider: 'microsoft_graph',
          options: { tenantId: 'x y', clientId: 'nope' },
          secrets: null,
        },
      },
      { ...SAVE, fromAddress: 'not an address' },
      { ...SAVE, fromName: 'A\r\nBcc: x@evil.example' },
      { ...SAVE, replyTo: 'nope' },
      { ...SAVE, extra: true },
    ]) {
      // Deliberately invalid entries, as a tampered request would send them.
      expect((await save(bad as unknown as typeof SAVE)).ok).toBe(false);
    }
    expect(db.saveTenantEmailSettings).not.toHaveBeenCalled();
  });

  it('maps the database refusals; a stale page is a version conflict', async () => {
    const { rt } = runtime(forRoles('tenant_admin'));
    const save = createDefineAction(rt)(saveTenantEmailSettingsActionDefinition());
    db.saveTenantEmailSettings.mockRejectedValueOnce(
      new FakeEmailSettingsError('EMAIL_SETTINGS_CONFLICT'),
    );
    expect(await save(SAVE)).toMatchObject({ ok: false, error: { code: 'CONFLICT_VERSION' } });
    db.saveTenantEmailSettings.mockRejectedValueOnce(
      new FakeEmailSettingsError('EMAIL_SETTINGS_INVALID', 'from_address'),
    );
    expect(await save(SAVE)).toMatchObject({
      ok: false,
      error: { fieldErrors: [{ path: 'fromAddress', code: 'INVALID' }] },
    });
    db.saveTenantEmailSettings.mockRejectedValueOnce(
      new FakeEmailSettingsError('EMAIL_SETTINGS_KEY_CHANGED'),
    );
    expect(await save(SAVE)).toMatchObject({
      ok: false,
      error: { fieldErrors: [{ path: 'form', code: 'KEY_CHANGED' }] },
    });
    db.saveTenantEmailSettings.mockRejectedValueOnce(
      new FakeEmailSettingsError('EMAIL_SETTINGS_FORBIDDEN'),
    );
    expect(await save(SAVE)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    // The worker's public key cannot be read (42501 in the database): FORBIDDEN, never an internal error.
    db.getEmailCredentialsPublicKey.mockRejectedValueOnce(
      new FakeEmailSettingsError('EMAIL_SETTINGS_FORBIDDEN'),
    );
    expect(await save(SAVE)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('starts the immediate send in its transaction once the test is queued, and not for a refused request', async () => {
    const startTest = vi.fn(() => Promise.resolve());
    const { rt } = runtime(forRoles('tenant_admin'));
    const action = createDefineAction(rt)(requestTenantEmailTestActionDefinition({ startTest }));
    expect(await action({ recipient: 'it@raya.example' })).toMatchObject({ ok: true });
    expect(startTest).toHaveBeenCalledTimes(1);
    startTest.mockClear();
    db.requestTenantEmailTest.mockRejectedValueOnce(
      new FakeEmailSettingsError('EMAIL_SETTINGS_TOO_SOON'),
    );
    expect(await action({ recipient: 'it@raya.example' })).toMatchObject({ ok: false });
    expect(startTest).not.toHaveBeenCalled();
  });

  it('a test e-mail too soon after the last one is RATE_LIMITED (one a minute, 20 a day)', async () => {
    const { rt, writeAudit } = runtime(forRoles('tenant_admin'));
    db.requestTenantEmailTest.mockRejectedValueOnce(
      new FakeEmailSettingsError('EMAIL_SETTINGS_TOO_SOON'),
    );
    expect(
      await createDefineAction(rt)(requestTenantEmailTestActionDefinition())({
        recipient: 'it@raya.example',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED', fieldErrors: [{ path: 'form', code: 'TOO_SOON' }] },
    });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it.each([['hr_manager'], ['auditor'], ['learner']] as const)(
    'refuses the %s to save, test or switch',
    async (role) => {
      const { rt } = runtime(forRoles(role));
      const define = createDefineAction(rt);
      for (const result of [
        await define(saveTenantEmailSettingsActionDefinition())(SAVE),
        await define(requestTenantEmailTestActionDefinition())({ recipient: 'it@raya.example' }),
        await define(setTenantEmailEnabledActionDefinition())({ enabled: true, version: 1 }),
      ]) {
        expect(!result.ok && result.error.code).toBe('FORBIDDEN');
      }
      expect(db.saveTenantEmailSettings).not.toHaveBeenCalled();
      expect(db.requestTenantEmailTest).not.toHaveBeenCalled();
      expect(db.setTenantEmailEnabled).not.toHaveBeenCalled();
      expect(db.getEmailCredentialsPublicKey).not.toHaveBeenCalled();
    },
  );
});

describe('testing and switching', () => {
  it('a test is queued and audited without the recipient', async () => {
    const { rt, writeAudit } = runtime(forRoles('tenant_admin'));
    expect(
      await createDefineAction(rt)(requestTenantEmailTestActionDefinition())({
        recipient: 'it@raya.example',
      }),
    ).toEqual({
      ok: true,
      value: { tenantId: TENANT, provider: 'sendgrid' },
    });
    expect(db.requestTenantEmailTest).toHaveBeenCalledWith(TX, 'it@raya.example');
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain('it@raya');
    expect(writeAudit).toHaveBeenCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({ action: 'platform.email.integration_test_requested' }),
    );
  });

  it('switching on before a test went out is refused; switching off goes back to the platform sender (audited)', async () => {
    const { rt, writeAudit } = runtime(forRoles('tenant_admin'));
    const toggle = createDefineAction(rt)(setTenantEmailEnabledActionDefinition());
    db.setTenantEmailEnabled.mockRejectedValueOnce(
      new FakeEmailSettingsError('EMAIL_SETTINGS_NOT_VERIFIED'),
    );
    expect(await toggle({ enabled: true, version: 1 })).toMatchObject({
      ok: false,
      error: { fieldErrors: [{ path: 'enabled', code: 'NOT_VERIFIED' }] },
    });
    expect(await toggle({ enabled: false, version: 1 })).toEqual({
      ok: true,
      value: { tenantId: TENANT, version: 2, enabled: false, changed: true },
    });
    expect(writeAudit).toHaveBeenCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({ action: 'platform.email.integration_disabled' }),
    );
    db.setTenantEmailEnabled.mockResolvedValueOnce(5);
    writeAudit.mockClear();
    expect(await toggle({ enabled: false, version: 5 })).toMatchObject({
      ok: true,
      value: { changed: false },
    });
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
