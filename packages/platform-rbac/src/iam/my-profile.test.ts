import { appError, err, ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { MEMBER_GRANTS } from '../member-permissions';
import { SYSTEM_ROLES } from '../system-roles';
import {
  MyProfileInput,
  changeMyPasswordActionDefinition,
  myIdentityQueryDefinition,
  myProfileQueryDefinition,
  personalDetailsFrom,
  updateMyProfileActionDefinition,
} from './my-profile';

const db = vi.hoisted(() => ({
  getPersonalDetails: vi.fn(),
  getUserProfile: vi.fn(),
  updatePersonalDetails: vi.fn(),
  passwordMinLengthForCaller: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const ME = '33333333-3333-4333-8333-333333333333';

function runtime(personId: string | null = ME, grants = MEMBER_GRANTS) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const rt: ActionRuntime<UserTx> = {
    getClaims: () => {
      const r = brandVerifiedClaims({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        aal: 'aal1',
        tenant_id: '22222222-2222-4222-8222-222222222222',
        ...(personId ? { person_id: personId } : {}),
      });
      if (!r.ok) throw new Error('fixture');
      return Promise.resolve(ok(r.value));
    },
    withUserTx: (_c, fn) => fn(TX),
    loadGrants: () => Promise.resolve([...grants]),
    resolveResource: () => Promise.resolve(null),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit };
}

const form = {
  firstNameAr: ' سارة ',
  fatherNameAr: 'عبدالله',
  grandfatherNameAr: '',
  familyNameAr: 'القحطاني',
  firstNameEn: 'Sarah',
  fatherNameEn: '',
  grandfatherNameEn: '',
  familyNameEn: 'Alqahtani',
  mobile: '٠٠٩٦٦ 55-123 4567',
  preferredLocale: 'en' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.passwordMinLengthForCaller.mockResolvedValue(12);
});

describe('My profile input (FR-IAM-16)', () => {
  it('composes display names, trims, and normalizes the mobile number', () => {
    const parsed = MyProfileInput.parse(form);
    expect(personalDetailsFrom(parsed)).toEqual({
      firstNameAr: 'سارة',
      fatherNameAr: 'عبدالله',
      grandfatherNameAr: null,
      familyNameAr: 'القحطاني',
      firstNameEn: 'Sarah',
      fatherNameEn: null,
      grandfatherNameEn: null,
      familyNameEn: 'Alqahtani',
      displayNameAr: 'سارة عبدالله القحطاني',
      displayNameEn: 'Sarah Alqahtani',
      mobileE164: '+966551234567',
      preferredLocale: 'en',
    });
    const noEnglish = MyProfileInput.parse({
      ...form,
      familyNameAr: '',
      firstNameEn: '',
      familyNameEn: '',
      mobile: '',
    });
    expect(personalDetailsFrom(noEnglish)).toMatchObject({
      displayNameAr: 'سارة عبدالله', // family name optional
      displayNameEn: null,
      mobileE164: null,
    });
  });

  it('rejects missing Arabic names, invisible-only names, local mobiles and any job or e-mail field', () => {
    for (const bad of [
      { ...form, firstNameAr: '' },
      { ...form, firstNameAr: '   ' },
      // Four parts of 60 make a display name over 200 characters (database limit).
      {
        ...form,
        firstNameAr: 'س'.repeat(60),
        fatherNameAr: 'ع'.repeat(60),
        grandfatherNameAr: 'م'.repeat(60),
        familyNameAr: 'ق'.repeat(60),
      },
      { ...form, firstNameAr: String.fromCodePoint(0x200f, 0x200b) },
      { ...form, mobile: '0551234567' },
      { ...form, firstNameAr: 'س'.repeat(61) },
      { ...form, email: 'other@example.test' },
      { ...form, departmentId: ME },
      { ...form, employeeNumber: 'X' },
      { ...form, preferredLocale: 'fr' },
    ]) {
      expect(MyProfileInput.safeParse(bad).success, JSON.stringify(Object.keys(bad))).toBe(false);
    }
  });
});

describe('My profile query and save', () => {
  it('reads only the member’s own person', async () => {
    db.getPersonalDetails.mockResolvedValue({ displayNameAr: 'س' });
    db.getUserProfile.mockResolvedValue({ personId: ME });
    const query = createDefineQuery(runtime().rt)(myProfileQueryDefinition());
    expect(await query({})).toEqual(
      ok({ details: { displayNameAr: 'س' }, profile: { personId: ME } }),
    );
    expect(db.getPersonalDetails).toHaveBeenCalledWith(TX, ME);
    expect(db.getUserProfile).toHaveBeenCalledWith(TX, ME, {
      includeRoles: false,
      includeActivity: false,
    });
  });

  it('reads the header name of the member', async () => {
    db.getPersonalDetails.mockResolvedValue({ displayNameAr: 'سارة', displayNameEn: null });
    const identity = createDefineQuery(runtime().rt)(myIdentityQueryDefinition());
    expect(await identity({})).toEqual(ok({ displayNameAr: 'سارة', displayNameEn: null }));
    const none = await createDefineQuery(runtime(null).rt)(myIdentityQueryDefinition())({});
    expect(!none.ok && none.error.code).toBe('NOT_FOUND');
  });

  it('a member without a person (or a vanished one) gets NOT_FOUND', async () => {
    const noPerson = await createDefineQuery(runtime(null).rt)(myProfileQueryDefinition())({});
    expect(!noPerson.ok && noPerson.error.code).toBe('NOT_FOUND');
    db.getPersonalDetails.mockResolvedValue(null);
    db.getUserProfile.mockResolvedValue(null);
    const gone = await createDefineQuery(runtime().rt)(myProfileQueryDefinition())({});
    expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
  });

  it('saves own details and audits the changed field names only (no values)', async () => {
    db.updatePersonalDetails.mockResolvedValue(['firstNameAr', 'mobileE164']);
    const { rt, writeAudit } = runtime();
    const save = createDefineAction(rt)(updateMyProfileActionDefinition());
    const result = await save(form);
    expect(result).toEqual(
      ok({ personId: ME, changed: ['firstNameAr', 'mobileE164'], preferredLocale: 'en' }),
    );
    expect(db.updatePersonalDetails).toHaveBeenCalledWith(
      TX,
      ME,
      expect.objectContaining({ mobileE164: '+966551234567' }),
    );
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.profile.updated',
      entityType: 'person',
      entityId: ME,
      data: { changed: ['firstNameAr', 'mobileE164'] },
    });
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain('سارة');
  });

  it('no change → no audit event; vanished person → NOT_FOUND; no member grant → 403', async () => {
    db.updatePersonalDetails.mockResolvedValue([]);
    const { rt, writeAudit } = runtime();
    expect((await createDefineAction(rt)(updateMyProfileActionDefinition())(form)).ok).toBe(true);
    expect(writeAudit).not.toHaveBeenCalled();
    db.updatePersonalDetails.mockResolvedValue(null);
    const gone = await createDefineAction(runtime().rt)(updateMyProfileActionDefinition())(form);
    expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
    const denied = await createDefineAction(runtime(ME, []).rt)(updateMyProfileActionDefinition())(
      form,
    );
    expect(!denied.ok && denied.error.code).toBe('FORBIDDEN');
  });
});

describe('change my password', () => {
  const input = {
    currentPassword: 'Old-password-123',
    newPassword: 'New-password-4567',
    confirmPassword: 'New-password-4567',
  };

  it('changes the password and audits without any password', async () => {
    const changePassword = vi.fn(() => Promise.resolve(ok({ userId: 'u1' })));
    const { rt, writeAudit } = runtime();
    const result = await createDefineAction(rt)(changeMyPasswordActionDefinition(changePassword))(
      input,
    );
    expect(result).toEqual(ok({ userId: 'u1' }));
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'Old-password-123',
      newPassword: 'New-password-4567',
    });
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.auth.password_changed',
      entityType: 'user',
      entityId: 'u1',
    });
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain('password-');
  });

  it('runs the after-change step (the "password changed" notice) in the action transaction, only on success', async () => {
    const afterChange = vi.fn(() => Promise.resolve());
    const changed = vi.fn(() => Promise.resolve(ok({ userId: 'u1' })));
    const result = await createDefineAction(runtime().rt)(
      changeMyPasswordActionDefinition(changed, afterChange),
    )(input);
    expect(result).toEqual(ok({ userId: 'u1' }));
    expect(afterChange).toHaveBeenCalledWith(TX, 'u1');

    afterChange.mockClear();
    const refused = vi.fn(() => Promise.resolve(err(appError('RATE_LIMITED'))));
    await createDefineAction(runtime().rt)(changeMyPasswordActionDefinition(refused, afterChange))(
      input,
    );
    expect(afterChange).not.toHaveBeenCalled();
  });

  it('validates length and confirmation before calling Auth; passes Auth errors through', async () => {
    const changePassword = vi.fn(() => Promise.resolve(err(appError('RATE_LIMITED'))));
    const action = createDefineAction(runtime().rt)(
      changeMyPasswordActionDefinition(changePassword),
    );
    for (const bad of [
      { ...input, newPassword: 'short', confirmPassword: 'short' },
      { ...input, confirmPassword: 'different-password' },
      { ...input, extra: 'x' },
      // 74 bytes (bcrypt limit is 72): 37 Arabic letters.
      { ...input, newPassword: 'ك'.repeat(37), confirmPassword: 'ك'.repeat(37) },
    ]) {
      const result = await action(bad);
      expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
    }
    expect(changePassword).not.toHaveBeenCalled();
    const limited = await action(input);
    expect(!limited.ok && limited.error.code).toBe('RATE_LIMITED');
  });

  it("applies the strictest minimum of the account's organizations before Auth (T-M2-10)", async () => {
    const changePassword = vi.fn(() => Promise.resolve(ok({ userId: 'u1' })));
    const action = createDefineAction(runtime().rt)(
      changeMyPasswordActionDefinition(changePassword),
    );
    db.passwordMinLengthForCaller.mockResolvedValue(input.newPassword.length + 1);
    const short = await action(input);
    expect(!short.ok && short.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [
        { path: 'newPassword', code: 'TOO_SMALL', params: { min: input.newPassword.length + 1 } },
      ],
    });
    expect(changePassword).not.toHaveBeenCalled();
    // Characters, not UTF-16 units; exactly the minimum is enough.
    db.passwordMinLengthForCaller.mockResolvedValue(Array.from(input.newPassword).length);
    expect((await action(input)).ok).toBe(true);
    // A session the database no longer accepts: sign in again.
    db.passwordMinLengthForCaller.mockResolvedValue(null);
    const gone = await action(input);
    expect(!gone.ok && gone.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('member permissions', () => {
  it('every member manages only their own profile, and no role grants it', () => {
    expect(MEMBER_GRANTS).toEqual([
      { permission: 'platform.profile.manage_own', scope: { type: 'own' } },
    ]);
    for (const role of SYSTEM_ROLES) {
      expect(role.grants.map((g) => g.permission.code)).not.toContain(
        'platform.profile.manage_own',
      );
    }
  });
});
