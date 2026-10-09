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
  FILE_PURPOSES,
  confirmUpload,
  createDownloadGrant,
  createUploadIntent,
  getFileStatus,
} from '../index';
import { collect, streamOf } from '../test-fixtures';
import type { Scanner } from './clamd';
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
  const owner = createDatabase(ownerUrl ?? '', { max: 1 });
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
  };
  const store: FileObjectStore = {
    read(_bucket, key) {
      const bytes = objects.get(key);
      return Promise.resolve(bytes ? { body: streamOf(bytes), size: bytes.length } : null);
    },
    move: () => Promise.resolve('moved'),
    remove: () => Promise.resolve(),
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
  const context = {
    ownTx: <T>(fn: Parameters<typeof withUserTx<T>>[1]) => withUserTx(claims, fn),
    storage,
  };

  /** The member uploads `bytes`: intent, the browser's PUT (Storage's insert), confirmation. */
  async function upload(bytes: Uint8Array, name: string) {
    const intent = await createUploadIntent(context, {
      purpose: 'platform.user_import',
      owner: { module: 'platform', entityType: 'user_import', entityId: randomUUID() },
      declaredName: name,
      declaredType: 'text/csv',
      size: bytes.length,
    });
    const [row] = await owner.execute<{ object_key: string }>(
      sql`select object_key from platform.files where id = ${intent.fileId}::uuid`,
    );
    const key = row?.object_key ?? '';
    objects.set(key, bytes);
    await owner.execute(sql`insert into storage.objects (bucket_id, name, owner, metadata)
      values ('imports', ${key}, ${member.user}, ${JSON.stringify({ size: bytes.length })}::jsonb)`);
    const confirmed = await withUserTx(claims, (tx) => confirmUpload(tx, intent.fileId));
    expect(confirmed.status).toBe('uploaded');
    return { id: intent.fileId, key };
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
    await owner.execute(sql`insert into platform.tenants (id, slug, name_ar, name_en, status)
      values (${tenant}, ${`files-${tenant.slice(0, 8)}`}, 'شركة الملفات', 'Files Company', 'active')`);
    await owner.execute(sql`insert into auth.users (id, email)
      values (${member.user}, ${`sara.${tenant.slice(0, 8)}@test.example`})`);
    await owner.execute(sql`insert into platform.persons (id, tenant_id, display_name_ar, display_name_en)
      values (${member.person}, ${tenant}, 'سارة', 'Sara')`);
    await owner.execute(sql`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
      values (${tenant}, ${member.user}, ${member.person}, 'active')`);
    await owner.execute(
      sql`insert into auth.sessions (id, user_id) values (${member.session}, ${member.user})`,
    );
    await owner.execute(sql`insert into platform.session_context (session_id, user_id, active_tenant_id)
      values (${member.session}, ${member.user}, ${tenant})`);
  });

  afterAll(async () => {
    await owner.execute(sql`delete from storage.objects where name like ${`${tenant}/%`}`);
    await owner.$client.end({ timeout: 5 });
    await serverDb.$client.end({ timeout: 5 });
    await workerDb.$client.end({ timeout: 5 });
  });

  it('the purposes mirror platform.file_purposes exactly', async () => {
    const rows = await owner.execute<{
      purpose: string;
      bucket: string;
      max_bytes: string;
      allowed_types: string[];
      retention_class: string;
      upload_by: string;
      audit_downloads: boolean;
      download_ttl_seconds: number;
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
        },
      ]),
    );
    expect(database).toEqual(JSON.parse(JSON.stringify(FILE_PURPOSES)));
  });

  it('upload → clean → download grant (audited) → a job streams the verified bytes', async () => {
    const csv = new TextEncoder().encode('email,first_name\nsara@files.example,سارة\n');
    const { id, key } = await upload(csv, 'موظفو الرياض.csv');
    expect(signed).toContain(`imports/${key}`);
    const view = await scanned(id);
    expect(view).toMatchObject({
      status: 'clean',
      name: 'موظفو الرياض.csv',
      detectedType: 'text/csv',
      size: csv.length,
      sha256: createHash('sha256').update(csv).digest('hex'),
    });
    const [events] = await owner.execute<{
      n: string;
    }>(sql`select count(*) as n from platform.event_outbox
      where subject = ${id}::uuid and type in ('com.entlaqa.platform.file.uploaded', 'com.entlaqa.platform.file.scanned')`);
    expect(Number(events?.n)).toBe(2);

    const link = await createDownloadGrant(context, actor, id);
    expect(link.url).toContain('ttl=60');
    const [audit] = await owner.execute<{
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
    const { id } = await upload(new TextEncoder().encode('a,b\nEVIL\n'), 'تقرير.csv');
    const view = await scanned(id);
    expect(view).toMatchObject({ status: 'infected', reason: 'malware' });
    const [row] = await owner.execute<{ bucket: string; scan_finding: string }>(
      sql`select bucket, scan_finding from platform.files where id = ${id}::uuid`,
    );
    expect(row).toEqual({ bucket: 'quarantine', scan_finding: 'Eicar-Test-Signature' });
    const [audit] = await owner.execute<{
      n: string;
    }>(sql`select count(*) as n from platform.audit_events
      where action = 'platform.file.infected' and entity_id = ${id} and actor_user_id is null`);
    expect(Number(audit?.n)).toBe(1);
    await expect(createDownloadGrant(context, actor, id)).rejects.toMatchObject({
      code: 'FILE_NOT_CLEAN',
    });
    await expect(
      withSystemTx({ tenantId: tenant, jobId: randomUUID() }, (tx) =>
        createWorkerFiles({ store }).openScannedFile(tx, id),
      ),
    ).rejects.toMatchObject({ code: 'FILE_NOT_CLEAN' });
    expect(logs.join('\n')).not.toContain('تقرير');
  });
});
