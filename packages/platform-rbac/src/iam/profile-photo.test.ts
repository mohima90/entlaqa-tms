import { appError, err, ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { MEMBER_GRANTS } from '../member-permissions';
import { type TestRoleCode, testRoleGrants } from '../testing/former-roles';
import {
  type ProfilePhotoFileService,
  type ProfilePhotoReader,
  confirmProfilePhotoUploadActionDefinition,
  matchesPhotoEtag,
  personPhotoQueryDefinition,
  profilePhotoOwner,
  removeProfilePhotoActionDefinition,
  saveProfilePhotoActionDefinition,
  startProfilePhotoUploadActionDefinition,
} from './profile-photo';

const db = vi.hoisted(() => ({
  publishProfilePhoto: vi.fn(),
  removeProfilePhoto: vi.fn(),
  getPersonPhotoFacts: vi.fn(),
  getPersonPhotoContent: vi.fn(),
  isDomainError: (error: unknown, ...codes: string[]) =>
    error instanceof Error &&
    error.name === 'DomainError' &&
    (codes.length === 0 || codes.includes((error as { code?: string }).code ?? '')),
  DomainError: class DomainError extends Error {
    override readonly name = 'DomainError';
    constructor(readonly code: string) {
      super(code);
    }
  },
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const FILE = '66666666-6666-4666-8666-666666666666';

function runtime(roles: TestRoleCode[] = ['learner'], personId: string | null = ME) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const rt: ActionRuntime<UserTx> = {
    getClaims: () => {
      const r = brandVerifiedClaims({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        aal: 'aal1',
        tenant_id: TENANT,
        ...(personId ? { person_id: personId } : {}),
      });
      if (!r.ok) throw new Error('fixture');
      return Promise.resolve(ok(r.value));
    },
    withUserTx: (_c, fn) => fn(TX),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: true }),
    // Every member holds `platform.profile.manage_own` on their own record, whatever the roles.
    loadGrants: () => Promise.resolve([...MEMBER_GRANTS, ...testRoleGrants(roles, [])]),
    resolveResource: () => Promise.resolve(null),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit };
}

const publication = {
  fileId: FILE,
  sourceSha256: 'a'.repeat(64),
  sourceSize: 100,
  contentType: 'image/jpeg',
  content: new Uint8Array([1, 2, 3]),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the owner of a photo', () => {
  it('is the person themself', () => {
    expect(profilePhotoOwner(ME)).toEqual({
      module: 'platform',
      entityType: 'person',
      entityId: ME,
    });
  });
});

describe('uploading', () => {
  function files(): ProfilePhotoFileService<{ fileId: string }, { url: string }> {
    return {
      reserve: vi.fn(() => Promise.resolve(ok({ fileId: FILE }))),
      sign: vi.fn(() => Promise.resolve(ok({ url: 'https://storage.test/put' }))),
      confirm: vi.fn(() =>
        Promise.resolve(
          ok({
            fileId: FILE,
            purpose: 'platform.profile_photo',
            status: 'uploaded',
            reason: null,
          }) as never,
        ),
      ),
      status: vi.fn(() =>
        Promise.resolve({
          fileId: FILE,
          purpose: 'platform.profile_photo',
          status: 'pending_upload',
          reason: null,
        } as never),
      ),
      purpose: 'platform.profile_photo',
    };
  }

  it('reserves the upload for the member’s OWN person and signs it after the commit', async () => {
    const service = files();
    const { rt } = runtime();
    const result = await createDefineAction(rt)(startProfilePhotoUploadActionDefinition(service))({
      fileName: 'photo.jpg',
      size: 90_000,
    });
    expect(result).toEqual(ok({ url: 'https://storage.test/put' }));
    expect(service.reserve).toHaveBeenCalledWith(TX, {
      owner: profilePhotoOwner(ME),
      declaredName: 'photo.jpg',
      size: 90_000,
    });
  });

  it('refuses more than 2 MB, an empty file and extra fields; a member without a person gets NOT_FOUND', async () => {
    const service = files();
    const run = (input: unknown, personId: string | null = ME) =>
      createDefineAction(runtime(['learner'], personId).rt)(
        startProfilePhotoUploadActionDefinition(service),
      )(input as never);
    expect((await run({ fileName: 'a.jpg', size: 2 * 1024 * 1024 + 1 })).ok).toBe(false);
    expect((await run({ fileName: 'a.jpg', size: 0 })).ok).toBe(false);
    expect((await run({ fileName: 'a.jpg', size: 10, owner: 'x' })).ok).toBe(false);
    const none = await run({ fileName: 'a.jpg', size: 10 }, null);
    expect(!none.ok && none.error.code).toBe('NOT_FOUND');
    expect(service.reserve).not.toHaveBeenCalled();
  });

  it('confirms only a file of the photo purpose', async () => {
    const service = files();
    const confirm = createDefineAction(runtime().rt)(
      confirmProfilePhotoUploadActionDefinition(service),
    );
    expect(await confirm({ fileId: FILE })).toEqual(
      ok({ fileId: FILE, status: 'uploaded', reason: null }),
    );
    vi.mocked(service.status).mockResolvedValue({
      fileId: FILE,
      purpose: 'platform.user_import',
      status: 'pending_upload',
      reason: null,
    } as never);
    const other = await confirm({ fileId: FILE });
    expect(!other.ok && other.error.code).toBe('NOT_FOUND');
    vi.mocked(service.status).mockResolvedValue(null);
    expect((await confirm({ fileId: FILE })).ok).toBe(false);
  });
});

describe('saving the photo', () => {
  const reader = (reading: Awaited<ReturnType<ProfilePhotoReader>>) =>
    vi.fn<ProfilePhotoReader>(() => Promise.resolve(reading));
  const save = (read: ProfilePhotoReader, roles: TestRoleCode[] = ['learner']) => {
    const { rt, writeAudit } = runtime(roles);
    return {
      writeAudit,
      run: () => createDefineAction(rt)(saveProfilePhotoActionDefinition(read))({ fileId: FILE }),
    };
  };

  it('reads the member’s own upload BEFORE the transaction, publishes it and audits the file name only', async () => {
    db.publishProfilePhoto.mockResolvedValue({ fileName: 'photo.jpg', replaced: false });
    const read = reader(ok({ publication }));
    const { run, writeAudit } = save(read);
    expect(await run()).toEqual(ok({ personId: ME, fileName: 'photo.jpg', replaced: false }));
    expect(read).toHaveBeenCalledWith({ tenantId: TENANT, personId: ME, fileId: FILE });
    expect(db.publishProfilePhoto).toHaveBeenCalledWith(TX, publication);
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.profile.photo_added',
      entityType: 'person',
      entityId: ME,
      data: { fileName: 'photo.jpg' },
    });
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain('"content"');
  });

  it('audits a replacement as replaced', async () => {
    db.publishProfilePhoto.mockResolvedValue({ fileName: 'new.png', replaced: true });
    const { run, writeAudit } = save(reader(ok({ publication })));
    await run();
    expect(writeAudit).toHaveBeenCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({ action: 'platform.profile.photo_replaced' }),
    );
  });

  it('answers on the field `photo` with the reason when the file cannot be used — nothing is published or audited', async () => {
    for (const refused of [
      'TYPE_NOT_ALLOWED',
      'TOO_LARGE',
      'DIMENSIONS_TOO_LARGE',
      'MALFORMED',
      'EMPTY',
    ] as const) {
      const { run, writeAudit } = save(reader(ok({ refused })));
      const result = await run();
      expect(!result.ok && result.error.fieldErrors).toEqual([
        { path: 'photo', code: `IMAGE_${refused}` },
      ]);
      expect(writeAudit).not.toHaveBeenCalled();
    }
    const missing = await save(reader(ok({ missing: true }))).run();
    expect(!missing.ok && missing.error.fieldErrors).toEqual([
      { path: 'photo', code: 'IMAGE_NOT_USABLE' },
    ]);
    expect(db.publishProfilePhoto).not.toHaveBeenCalled();
  });

  it('passes on Storage being unavailable, and maps the database refusing the file', async () => {
    const unavailable = await save(reader(err(appError('NOT_CONFIGURED')))).run();
    expect(!unavailable.ok && unavailable.error.code).toBe('NOT_CONFIGURED');
    for (const code of ['PHOTO_NOT_USABLE', 'PHOTO_MISMATCH']) {
      db.publishProfilePhoto.mockRejectedValue(new db.DomainError(code));
      const result = await save(reader(ok({ publication }))).run();
      expect(!result.ok && result.error.fieldErrors).toEqual([
        { path: 'photo', code: 'IMAGE_NOT_USABLE' },
      ]);
    }
    db.publishProfilePhoto.mockRejectedValue(new Error('boom'));
    expect((await save(reader(ok({ publication }))).run()).ok).toBe(false);
  });

  it('a member without a person cannot save one', async () => {
    const { rt } = runtime(['learner'], null);
    const read = reader(ok({ publication }));
    const result = await createDefineAction(rt)(saveProfilePhotoActionDefinition(read))({
      fileId: FILE,
    });
    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    expect(read).not.toHaveBeenCalled();
  });
});

describe('removing the photo', () => {
  it('removes the member’s own photo and audits the file name', async () => {
    db.removeProfilePhoto.mockResolvedValue('photo.jpg');
    const { rt, writeAudit } = runtime();
    expect(await createDefineAction(rt)(removeProfilePhotoActionDefinition())({})).toEqual(
      ok({ personId: ME, fileName: 'photo.jpg' }),
    );
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.profile.photo_removed',
      entityType: 'person',
      entityId: ME,
      data: { fileName: 'photo.jpg' },
    });
  });

  it('records nothing when there was no photo', async () => {
    db.removeProfilePhoto.mockResolvedValue(null);
    const { rt, writeAudit } = runtime();
    expect((await createDefineAction(rt)(removeProfilePhotoActionDefinition())({})).ok).toBe(true);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe('delivering a photo', () => {
  const SHA = 'b'.repeat(64);
  const fetchPhoto = (input: { personId: string; ifNoneMatch: string | null }) =>
    createDefineQuery(runtime().rt)(personPhotoQueryDefinition())(input);

  it('matches If-None-Match, weak validators and lists included', () => {
    expect(matchesPhotoEtag(`"${SHA}"`, SHA)).toBe(true);
    expect(matchesPhotoEtag(`W/"${SHA}", "other"`, SHA)).toBe(true);
    expect(matchesPhotoEtag('*', SHA)).toBe(true);
    expect(matchesPhotoEtag('"other"', SHA)).toBe(false);
    expect(matchesPhotoEtag(null, SHA)).toBe(false);
  });

  it('answers the bytes, or «not modified» without reading them', async () => {
    db.getPersonPhotoFacts.mockResolvedValue({
      contentType: 'image/png',
      sha256: SHA,
      byteSize: 3,
    });
    db.getPersonPhotoContent.mockResolvedValue({
      contentType: 'image/png',
      content: new Uint8Array([1, 2, 3]),
      sha256: SHA,
    });
    const full = await fetchPhoto({ personId: ME, ifNoneMatch: null });
    expect(full.ok && full.value).toEqual({
      notModified: false,
      contentType: 'image/png',
      sha256: SHA,
      content: new Uint8Array([1, 2, 3]),
    });
    db.getPersonPhotoContent.mockClear();
    const cached = await fetchPhoto({ personId: ME, ifNoneMatch: `"${SHA}"` });
    expect(cached.ok && cached.value).toEqual({
      notModified: true,
      contentType: 'image/png',
      sha256: SHA,
    });
    expect(db.getPersonPhotoContent).not.toHaveBeenCalled();
  });

  it('NOT_FOUND for a person without a photo or one the database does not show', async () => {
    db.getPersonPhotoFacts.mockResolvedValue(null);
    const none = await fetchPhoto({ personId: ME, ifNoneMatch: null });
    expect(!none.ok && none.error.code).toBe('NOT_FOUND');
    db.getPersonPhotoFacts.mockResolvedValue({
      contentType: 'image/png',
      sha256: SHA,
      byteSize: 3,
    });
    db.getPersonPhotoContent.mockResolvedValue(null);
    const hidden = await fetchPhoto({ personId: ME, ifNoneMatch: null });
    expect(!hidden.ok && hidden.error.code).toBe('NOT_FOUND');
    expect((await fetchPhoto({ personId: 'not-a-uuid', ifNoneMatch: null })).ok).toBe(false);
  });
});
