import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  PlatformConsoleError,
  createPlatformTenant,
  isPlatformAdmin,
  listPlatformTenants,
  platformAdminInvitationCode,
  platformConsoleErrorOf,
  reissuePlatformAdminCode,
} from './platform-console';

const dialect = new PgDialect();
const TENANT = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';

type Answer = unknown[] | Error;

function fakeTx(...answers: Answer[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: (query: SQL) => {
      executed.push(dialect.sqlToQuery(query));
      const next = answers.shift() ?? [];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
  return { executed, tx: tx as never };
}

const pgErr = (code: string, message = `pg ${code}`) => Object.assign(new Error(message), { code });

describe('platformConsoleErrorOf', () => {
  it('maps the console refusals', () => {
    const notAdmin = platformConsoleErrorOf(pgErr('42501'));
    expect(notAdmin).toBeInstanceOf(PlatformConsoleError);
    expect((notAdmin as PlatformConsoleError).code).toBe('NOT_PLATFORM_ADMIN');
    const invalid = platformConsoleErrorOf(pgErr('JP001', 'admin_email')) as PlatformConsoleError;
    expect([invalid.code, invalid.field]).toEqual(['PLATFORM_INVALID_INPUT', 'admin_email']);
    const unknownField = platformConsoleErrorOf(
      pgErr('JP001', 'drop table'),
    ) as PlatformConsoleError;
    expect(unknownField.field).toBeNull();
    expect((platformConsoleErrorOf(pgErr('JP002')) as PlatformConsoleError).code).toBe(
      'SLUG_TAKEN',
    );
    expect((platformConsoleErrorOf(pgErr('JP003')) as PlatformConsoleError).code).toBe(
      'NO_PENDING_ADMIN',
    );
  });

  it('keeps anything else', () => {
    const other = pgErr('23505');
    expect(platformConsoleErrorOf(other)).toBe(other);
    const plain = new Error('network');
    expect(platformConsoleErrorOf(plain)).toBe(plain);
  });
});

describe('isPlatformAdmin', () => {
  it('asks the database (true only for an explicit yes)', async () => {
    const yes = fakeTx([{ yes: true }]);
    expect(await isPlatformAdmin(yes.tx)).toBe(true);
    expect(yes.executed[0]?.sql).toContain('private.is_platform_admin()');
    expect(await isPlatformAdmin(fakeTx([{ yes: false }]).tx)).toBe(false);
    expect(await isPlatformAdmin(fakeTx([]).tx)).toBe(false);
  });
});

describe('listPlatformTenants', () => {
  it('maps the rows', async () => {
    const { tx } = fakeTx([
      {
        tenant_id: TENANT,
        slug: 'entlaqa',
        name_ar: 'إنطلاقة',
        name_en: null,
        status: 'active',
        created_at: '2026-10-16T10:00:00Z',
        member_count: '0',
        admin_state: 'pending',
        admin_invitation_locale: 'ar',
        admin_invitation_expires_at: '2026-10-23T10:00:00Z',
      },
      {
        tenant_id: TENANT,
        slug: 'other',
        name_ar: 'أخرى',
        name_en: 'Other',
        status: 'weird',
        created_at: new Date('2026-10-01T00:00:00Z'),
        member_count: 3,
        admin_state: 'weird',
        admin_invitation_locale: null,
        admin_invitation_expires_at: null,
      },
    ]);
    const rows = await listPlatformTenants(tx);
    expect(rows[0]).toEqual({
      tenantId: TENANT,
      slug: 'entlaqa',
      nameAr: 'إنطلاقة',
      nameEn: null,
      status: 'active',
      createdAt: new Date('2026-10-16T10:00:00Z'),
      memberCount: 0,
      adminState: 'pending',
      adminInvitationLocale: 'ar',
      adminInvitationExpiresAt: new Date('2026-10-23T10:00:00Z'),
    });
    // Unknown values fail safe.
    expect([rows[1]?.status, rows[1]?.adminState, rows[1]?.memberCount]).toEqual([
      'suspended',
      'none',
      3,
    ]);
  });

  it('refuses a non-admin', async () => {
    await expect(listPlatformTenants(fakeTx(pgErr('42501')).tx)).rejects.toMatchObject({
      code: 'NOT_PLATFORM_ADMIN',
    });
  });
});

describe('createPlatformTenant', () => {
  it('sends trimmed values (blank names as null) and returns the code', async () => {
    const fake = fakeTx([{ tenant_id: TENANT, invitation_id: 'inv', invite_code: 'K7M2PQ9X' }]);
    const created = await createPlatformTenant(fake.tx, {
      slug: 'entlaqa',
      nameAr: ' إنطلاقة ',
      nameEn: '  ',
      adminEmail: ' Admin@Entlaqa.COM ',
      adminFirstNameAr: ' سارة ',
      adminFamilyNameAr: '',
      adminFirstNameEn: null,
      locale: 'en',
    });
    expect(created).toEqual({ tenantId: TENANT, invitationId: 'inv', inviteCode: 'K7M2PQ9X' });
    expect(fake.executed[0]?.sql).toContain('private.platform_create_tenant(');
    expect(fake.executed[0]?.params).toEqual([
      'entlaqa',
      'إنطلاقة',
      null,
      'admin@entlaqa.com',
      'سارة',
      null,
      null,
      null,
      'en',
    ]);
  });

  it('maps the refusals', async () => {
    const input = { slug: 'tenant-a', nameAr: 'أ', adminEmail: 'a@b.test', locale: 'en' as const };
    await expect(createPlatformTenant(fakeTx(pgErr('JP002')).tx, input)).rejects.toMatchObject({
      code: 'SLUG_TAKEN',
    });
    await expect(
      createPlatformTenant(fakeTx(pgErr('JP001', 'slug')).tx, input),
    ).rejects.toMatchObject({ code: 'PLATFORM_INVALID_INPUT', field: 'slug' });
    await expect(createPlatformTenant(fakeTx(pgErr('42501')).tx, input)).rejects.toMatchObject({
      code: 'NOT_PLATFORM_ADMIN',
    });
    await expect(createPlatformTenant(fakeTx([]).tx, input)).rejects.toThrow('no code returned');
  });
});

describe('the Organization Admin code', () => {
  it('reads the current code and issues a new one', async () => {
    const answer = [{ invite_code: 'ABCDEFGH', locale: 'ar', expires_at: '2026-10-23T10:00:00Z' }];
    const read = fakeTx(answer);
    expect(await platformAdminInvitationCode(read.tx, TENANT)).toEqual({
      inviteCode: 'ABCDEFGH',
      locale: 'ar',
      expiresAt: new Date('2026-10-23T10:00:00Z'),
    });
    expect(read.executed[0]?.sql).toContain('private.platform_admin_invitation_code(');
    expect(read.executed[0]?.params).toEqual([TENANT]);
    const issued = fakeTx(answer);
    expect((await reissuePlatformAdminCode(issued.tx, TENANT)).inviteCode).toBe('ABCDEFGH');
    expect(issued.executed[0]?.sql).toContain('private.platform_reissue_admin_code(');
  });

  it('refuses without a pending invitation', async () => {
    await expect(
      platformAdminInvitationCode(fakeTx(pgErr('JP003')).tx, TENANT),
    ).rejects.toMatchObject({ code: 'NO_PENDING_ADMIN' });
    await expect(reissuePlatformAdminCode(fakeTx([]).tx, TENANT)).rejects.toMatchObject({
      code: 'NO_PENDING_ADMIN',
    });
  });
});
