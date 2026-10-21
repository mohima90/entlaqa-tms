/**
 * Files against PostgreSQL (T-M2-18, ADR 0006): the request path under withUserTx (app_server, the
 * member's verified claims) and the worker's tasks under withPlatformTx / withSystemTx (app_worker), with
 * stand-ins for Storage (objects in memory; the browser's PUT is Storage's own insert into
 * storage.objects) and for clamd. The purposes mirror equals the database's table; an upload goes
 * pending → uploaded → clean and can then be granted and streamed to a job; an infected upload is
 * quarantined, audited and never granted.
 */
import { createHash, randomUUID } from 'node:crypto';
import { actorFromClaims, hasTenant } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { createDatabase, createWithUserTx } from '@jadarat/platform-db';
import { createWithPlatformTx, createWithSystemTx } from '@jadarat/platform-db/jobs';
import type { UserFileStorage } from '@jadarat/platform-db/supabase-server';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type DownloadRequest,
  FILE_PURPOSES,
  type UploadIntentInput,
  confirmUpload,
  getFileStatus,
  grantDownload,
  reserveUploadIntent,
  signDownload,
  signUploadIntent,
} from '../index';
import { collect, streamOf } from '../test-fixtures';
import type { Scanner } from './clamd';
import { createFileHousekeepingTask } from './housekeeping';
import { createFileScanTask } from './scan';
import type { FileObjectStore } from './store';
import { createWorkerFiles } from './worker-files';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const appWorkerUrl = process.env.TEST_APP_WORKER_URL;
const configured = Boolean(ownerUrl && appServerUrl && appWorkerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL, TEST_APP_SERVER_URL and TEST_APP_WORKER_URL must be set');
}

describe.skipIf(!configured)('files against PostgreSQL', () => {
  const db = createDatabase(ownerUrl ?? '', { max: 1 });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 2 });
  const workerDb = createDatabase(appWorkerUrl ?? '', { max: 2 });
  const withUserTx = createWithUserTx(() => serverDb);
  const withSystemTx = createWithSystemTx(() => workerDb);
  const withPlatformTx = createWithPlatformTx(() => workerDb);
  const tenant = randomUUID();
  const member = { user: randomUUID(), person: randomUUID(), session: randomUUID() };
  const verified = brandVerifiedClaims({
    sub: member.user,
    role: 'authenticated',
    aal: 'aal1',
    session_id: member.session,
    tenant_id: tenant,
    person_id: member.person,
  });
  if (!verified.ok) throw new Error('bad fixture');
  const claims = verified.value;
  if (!hasTenant(claims)) throw new Error('bad fixture');
  const actor = actorFromClaims(claims);

  /** Storage stand-in: objects by key; the signed URL is only recorded. */
  const objects = new Map<string, Uint8Array>();
  const signed: string[] = [];
  const storage: UserFileStorage = {
    createSignedUploadUrl(bucket, key) {
      signed.push(`${bucket}/${key}`);
      return Promise.resolve({ url: `https://storage.test/upload/${key}?token=t`, token: 't' });
    },
    createSignedDownloadUrl(bucket, key, ttl, name) {
      return Promise.resolve(
        `https://storage.test/${bucket}/${key}?ttl=${String(ttl)}&download=${name}`,
      );
    },
    readObject: (_bucket, key) => Promise.resolve(objects.get(key) ?? null),
  };
  const removed: string[] = [];
  const store: FileObjectStore = {
    read(_bucket, key) {
      const bytes = objects.get(key);
      return Promise.resolve(bytes ? { body: streamOf(bytes), size: bytes.length } : null);
    },
    move: () => Promise.resolve('moved'),
    remove: (bucket, key) => {
      removed.push(`${bucket}/${key}`);
      return Promise.resolve();
    },
    write: () => Promise.resolve(),
  };
  const scanner: Scanner = {
    ping: () => Promise.resolve(),
    version: () =>
      Promise.resolve({ engine: 'ClamAV 1.5.4', signatures: '28137', signaturesDate: new Date() }),
    start: () => {
      const seen: Uint8Array[] = [];
      return Promise.resolve({
        write: (chunk: Uint8Array) => {
          seen.push(chunk);
          return Promise.resolve();
        },
        finish: () =>
          Promise.resolve(
            Buffer.concat(seen).includes('EVIL')
              ? { clean: false as const, finding: 'Eicar-Test-Signature' }
              : { clean: true as const },
          ),
        abort: () => undefined,
      });
    },
  };
  const logs: string[] = [];
  const scan = createFileScanTask({
    withPlatformTx,
    withSystemTx,
    store,
    scanner,
    log: (level, message) => logs.push(`${level}: ${message}`),
  });
  // The shape of a file action (defineAction): the step in the action's transaction, Storage after the
  // commit (afterCommit) — never a second transaction inside the first (integration review M1).
  const createUploadIntent = async (input: UploadIntentInput) =>
    signUploadIntent(storage, await withUserTx(claims, (tx) => reserveUploadIntent(tx, input)));
  const createDownloadLink = async (request: DownloadRequest) =>
    signDownload(storage, await withUserTx(claims, (tx) => grantDownload(tx, actor, request)));

  /** The member uploads `bytes`: intent, the browser's PUT (Storage's insert), confirmation. */
  async function upload(bytes: Uint8Array, name: string) {
    const owner = { module: 'platform', entityType: 'user_import', entityId: randomUUID() };
    const intent = await createUploadIntent({
      purpose: 'platform.user_import',
      owner,
      declaredName: name,
      size: bytes.length,
    });
    expect(intent.contentType).toBe('text/csv');
    const [row] = await db.execute<{ object_key: string }>(
      sql`select object_key from platform.files where id = ${intent.fileId}::uuid`,
    );
    const key = row?.object_key ?? '';
    objects.set(key, bytes);
    // Storage records the PUT's Content-Type (the intent's contentType) with the object.
    await db.execute(sql`insert into storage.objects (bucket_id, name, owner, metadata)
      values ('imports', ${key}, ${member.user},
              ${JSON.stringify({ size: bytes.length, mimetype: intent.contentType })}::jsonb)`);
    const confirmed = await withUserTx(claims, (tx) => confirmUpload(tx, intent.fileId));
    expect(confirmed.status).toBe('uploaded');
    return {
      id: intent.fileId,
      key,
      request: { fileId: intent.fileId, purpose: 'platform.user_import' as const, owner },
    };
  }

  /** Scan passes until the file has a result (other files of the database may come first). */
  async function scanned(id: string) {
    for (let i = 0; i < 10; i += 1) {
      await scan.run({ jobId: randomUUID() });
      const view = await withUserTx(claims, (tx) => getFileStatus(tx, id));
      if (view && view.status !== 'uploaded' && view.status !== 'scanning') return view;
    }
    throw new Error('the file was not scanned');
  }

  beforeAll(async () => {
    await db.execute(sql`insert into platform.tenants (id, slug, name_ar, name_en, status)
      values (${tenant}, ${`files-${tenant.slice(0, 8)}`}, 'شركة الملفات', 'Files Company', 'active')`);
    await db.execute(sql`insert into auth.users (id, email)
      values (${member.user}, ${`sara.${tenant.slice(0, 8)}@test.example`})`);
    await db.execute(sql`insert into platform.persons (id, tenant_id, display_name_ar, display_name_en)
      values (${member.person}, ${tenant}, 'سارة', 'Sara')`);
    await db.execute(sql`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
      values (${tenant}, ${member.user}, ${member.person}, 'active')`);
    await db.execute(
      sql`insert into auth.sessions (id, user_id) values (${member.session}, ${member.user})`,
    );
    await db.execute(sql`insert into platform.session_context (session_id, user_id, active_tenant_id)
      values (${member.session}, ${member.user}, ${tenant})`);
  });

  afterAll(async () => {
    await db.execute(sql`delete from storage.objects where name like ${`${tenant}/%`}`);
    await db.$client.end({ timeout: 5 });
    await serverDb.$client.end({ timeout: 5 });
    await workerDb.$client.end({ timeout: 5 });
  });

  it('the purposes mirror platform.file_purposes exactly', async () => {
    const rows = await db.execute<{
      purpose: string;
      bucket: string;
      max_bytes: string;
      allowed_types: string[];
      retention_class: string;
      upload_by: string;
      audit_downloads: boolean;
      download_ttl_seconds: number;
      scan_required: boolean;
    }>(sql`select * from platform.file_purposes order by purpose`);
    const database = Object.fromEntries(
      rows.map((row) => [
        row.purpose,
        {
          bucket: row.bucket,
          maxBytes: Number(row.max_bytes),
          types: row.allowed_types,
          retention: row.retention_class,
          uploadBy: row.upload_by,
          auditDownloads: row.audit_downloads,
          downloadTtlSeconds: row.download_ttl_seconds,
          scanRequired: row.scan_required,
        },
      ]),
    );
    expect(database).toEqual(JSON.parse(JSON.stringify(FILE_PURPOSES)));
  });

  it('upload → clean → download grant (audited) → a job streams the verified bytes', async () => {
    const csv = new TextEncoder().encode('email,first_name\nsara@files.example,سارة\n');
    const { id, key, request } = await upload(csv, 'موظفو الرياض.csv');
    expect(signed).toContain(`imports/${key}`);
    const view = await scanned(id);
    expect(view).toMatchObject({
      status: 'clean',
      name: 'موظفو الرياض.csv',
      detectedType: 'text/csv',
      size: csv.length,
      sha256: createHash('sha256').update(csv).digest('hex'),
    });
    const [events] = await db.execute<{
      n: string;
    }>(sql`select count(*) as n from platform.event_outbox
      where subject = ${id}::uuid and type in ('com.entlaqa.platform.file.uploaded', 'com.entlaqa.platform.file.scanned')`);
    expect(Number(events?.n)).toBe(2);

    // Only for the owner entity the module authorized: another entity's request finds nothing.
    await expect(
      createDownloadLink({
        ...request,
        owner: { ...request.owner, entityId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    // Signing inside the action's transaction is refused (Storage would not see the grant yet, and the
    // request would hold its connection meanwhile): integration review M1.
    await expect(
      withUserTx(claims, async (tx) =>
        signDownload(storage, await grantDownload(tx, actor, request)),
      ),
    ).rejects.toThrow(/signDownload must run after the transaction commits/);
    const link = await createDownloadLink(request);
    expect(link.url).toContain('ttl=60');
    expect(link.name).toBe('موظفو الرياض.csv');
    const [audit] = await db.execute<{
      n: string;
    }>(sql`select count(*) as n from platform.audit_events
      where action = 'platform.file.download_granted' and entity_id = ${id} and actor_user_id = ${member.user}::uuid`);
    expect(Number(audit?.n)).toBe(1);

    const stream = await withSystemTx({ tenantId: tenant, jobId: randomUUID() }, (tx) =>
      createWorkerFiles({ store }).openScannedFile(tx, id),
    );
    expect(await collect(stream)).toEqual(csv);
  });

  it('infected: quarantined, audited as a security event, never granted', async () => {
    const { id, request } = await upload(new TextEncoder().encode('a,b\nEVIL\n'), 'تقرير.csv');
    const view = await scanned(id);
    expect(view).toMatchObject({ status: 'infected', reason: 'malware' });
    const [row] = await db.execute<{ bucket: string; scan_finding: string }>(
      sql`select bucket, scan_finding from platform.files where id = ${id}::uuid`,
    );
    expect(row).toEqual({ bucket: 'quarantine', scan_finding: 'Eicar-Test-Signature' });
    const [audit] = await db.execute<{
      n: string;
    }>(sql`select count(*) as n from platform.audit_events
      where action = 'platform.file.infected' and entity_id = ${id} and actor_user_id is null`);
    expect(Number(audit?.n)).toBe(1);
    await expect(createDownloadLink(request)).rejects.toMatchObject({
      code: 'FILE_NOT_CLEAN',
    });
    await expect(
      withSystemTx({ tenantId: tenant, jobId: randomUUID() }, (tx) =>
        createWorkerFiles({ store }).openScannedFile(tx, id),
      ),
    ).rejects.toMatchObject({ code: 'FILE_NOT_CLEAN' });
    expect(logs.join('\n')).not.toContain('تقرير');
  });

  /** The member uploads a branding logo (a purpose without a malware scan, PO 20 Oct 2026): confirmed. */
  async function uploadBrandLogo() {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    const intent = await createUploadIntent({
      purpose: 'platform.brand_logo',
      owner: { module: 'platform', entityType: 'tenant_branding', entityId: tenant },
      declaredName: 'logo.png',
      size: bytes.length,
    });
    const [row] = await db.execute<{ object_key: string }>(
      sql`select object_key from platform.files where id = ${intent.fileId}::uuid`,
    );
    const key = row?.object_key ?? '';
    objects.set(key, bytes);
    await db.execute(sql`insert into storage.objects (bucket_id, name, owner, metadata)
      values ('images', ${key}, ${member.user},
              ${JSON.stringify({ size: bytes.length, mimetype: intent.contentType })}::jsonb)`);
    const confirmed = await withUserTx(claims, (tx) => confirmUpload(tx, intent.fileId));
    expect(confirmed.status).toBe('uploaded');
    return { id: intent.fileId, key, bytes };
  }

  it('an accepted branding image (no malware scan) is never readable by a job (openScannedFile)', async () => {
    const { id, bytes } = await uploadBrandLogo();
    const sha = createHash('sha256').update(bytes).digest('hex');
    // Accepted as publish_brand_image leaves it (the write guard allows it for this purpose only).
    await db.execute(sql`update platform.files set status = 'accepted', status_reason = 'scan_not_required',
      detected_mime = 'image/png', size_bytes = ${bytes.length}, sha256 = ${sha} where id = ${id}::uuid`);
    await expect(
      withSystemTx({ tenantId: tenant, jobId: randomUUID() }, (tx) =>
        createWorkerFiles({ store }).openScannedFile(tx, id),
      ),
    ).rejects.toMatchObject({ code: 'FILE_NOT_CLEAN' });
    // Nor while it waits (uploaded): a job reads clean files only.
    const waiting = await uploadBrandLogo();
    await expect(
      withSystemTx({ tenantId: tenant, jobId: randomUUID() }, (tx) =>
        createWorkerFiles({ store }).openScannedFile(tx, waiting.id),
      ),
    ).rejects.toMatchObject({ code: 'FILE_NOT_CLEAN' });
  });

  it('housekeeping removes the raw upload of a branding image once its copy is published, and purges one unused after 24 hours (review M1)', async () => {
    const housekeeping = createFileHousekeepingTask({
      withPlatformTx,
      store,
      log: (level, message) => logs.push(`${level}: ${message}`),
    });
    const run = async (key: string) => {
      for (let i = 0; i < 5 && !removed.includes(`images/${key}`); i += 1) {
        await housekeeping.run({ jobId: randomUUID() });
      }
    };
    // Accepted and published: the object goes, the record stays (the copy in PostgreSQL is served).
    const published = await uploadBrandLogo();
    const sha = createHash('sha256').update(published.bytes).digest('hex');
    await db.execute(sql`update platform.files set status = 'accepted', status_reason = 'scan_not_required',
      detected_mime = 'image/png', size_bytes = ${published.bytes.length}, sha256 = ${sha}
      where id = ${published.id}::uuid`);
    await db.execute(sql`insert into platform.brand_assets (tenant_id, file_id, kind, content_type, content, byte_size, sha256)
      values (${tenant}::uuid, ${published.id}::uuid, 'logo', 'image/png', ${Buffer.from(published.bytes)}::bytea,
              ${published.bytes.length}, ${sha})`);
    await run(published.key);
    expect(removed).toContain(`images/${published.key}`);
    const [kept] = await db.execute<{ status: string; removed: boolean }>(
      sql`select status, object_removed_at is not null as removed from platform.files where id = ${published.id}::uuid`,
    );
    expect(kept).toEqual({ status: 'accepted', removed: true });

    // Uploaded 25 hours ago, never saved: purged (object and record).
    const abandoned = await uploadBrandLogo();
    await db.execute(sql`alter table platform.files disable trigger files_transition`);
    await db.execute(sql`update platform.files set uploaded_at = now() - interval '25 hours'
      where id = ${abandoned.id}::uuid`);
    await db.execute(sql`alter table platform.files enable trigger files_transition`);
    // A fresh upload waiting for the save is left alone.
    const fresh = await uploadBrandLogo();
    await run(abandoned.key);
    expect(removed).toContain(`images/${abandoned.key}`);
    expect(removed).not.toContain(`images/${fresh.key}`);
    const [left] = await db.execute<{ n: string }>(
      sql`select count(*) as n from platform.files where id = ${abandoned.id}::uuid`,
    );
    expect(Number(left?.n)).toBe(0);
  });

  it('housekeeping purges an abandoned upload (lock, removal and record in one transaction) and removes orphan objects', async () => {
    // An upload intent never used, 25 hours old: due for purge.
    const intent = await createUploadIntent({
      purpose: 'platform.user_import',
      owner: { module: 'platform', entityType: 'user_import', entityId: randomUUID() },
      declaredName: 'abandoned.csv',
      size: 10,
    });
    await db.execute(sql`alter table platform.files disable trigger files_transition`);
    await db.execute(
      sql`update platform.files set created_at = now() - interval '25 hours' where id = ${intent.fileId}::uuid`,
    );
    await db.execute(sql`alter table platform.files enable trigger files_transition`);
    const [row] = await db.execute<{ object_key: string }>(
      sql`select object_key from platform.files where id = ${intent.fileId}::uuid`,
    );
    // An object no file owns, written 4 hours ago (e.g. a report whose job rolled back).
    const orphanKey = `${tenant}/platform/user_import_report/${randomUUID()}/${randomUUID()}`;
    await db.execute(sql`insert into storage.objects (bucket_id, name, metadata, created_at)
      values ('generated', ${orphanKey}, '{"size": 5}', now() - interval '4 hours')`);
    const housekeeping = createFileHousekeepingTask({
      withPlatformTx,
      store,
      log: (level, message) => logs.push(`${level}: ${message}`),
    });
    for (let i = 0; i < 5 && !removed.includes(`imports/${row?.object_key ?? ''}`); i += 1) {
      await housekeeping.run({ jobId: randomUUID() });
    }
    expect(removed).toContain(`imports/${row?.object_key ?? ''}`);
    expect(removed).toContain(`generated/${orphanKey}`);
    const [left] = await db.execute<{ n: string }>(
      sql`select count(*) as n from platform.files where id = ${intent.fileId}::uuid`,
    );
    expect(Number(left?.n)).toBe(0);
  });
});
