/**
 * The bulk user import against PostgreSQL (T-M2-12, FR-IAM-04): the request path under withUserTx
 * (app_server, an Organization Admin's verified claims) and the worker task under withPlatformTx /
 * withSystemTx (app_worker), with stand-ins for Storage and clamd. A CSV file goes upload → scan →
 * read → mapping → dry run → review → confirm → run → held invitations scheduled and sent → result and
 * error report → undo → purge; an XLSX file is read and cancelled. Nothing of a row reaches the logs.
 */
import { randomUUID } from 'node:crypto';
import { hasTenant } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import {
  cancelUserImport,
  chooseUserImportMapping,
  confirmUserImport,
  createDatabase,
  createUserImport,
  createWithUserTx,
  getUserImport,
  listUserImportColumns,
  listUserImportRows,
  requestUserImportUndo,
  scheduleHeldInvitations,
} from '@jadarat/platform-db';
import { createWithPlatformTx, createWithSystemTx } from '@jadarat/platform-db/jobs';
import type { UserFileStorage } from '@jadarat/platform-db/supabase-server';
import { confirmUpload, createUploadIntent } from '@jadarat/platform-files';
import {
  type FileObjectStore,
  type Scanner,
  createFileScanTask,
  createWorkerFiles,
} from '@jadarat/platform-files/jobs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSV_BOM, csvLine, readCsvRows, unneutralizeFormula } from '../spreadsheet/csv';
import { writeXlsx } from '../spreadsheet/xlsx-writer';
import { proposedMapping, recognizeColumns } from '../users/headers';
import { createUserImportTask } from './task';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const appWorkerUrl = process.env.TEST_APP_WORKER_URL;
const configured = Boolean(ownerUrl && appServerUrl && appWorkerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL, TEST_APP_SERVER_URL and TEST_APP_WORKER_URL must be set');
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe.skipIf(!configured)('user import against PostgreSQL', () => {
  const db = createDatabase(ownerUrl ?? '', { max: 1 });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 3 });
  const workerDb = createDatabase(appWorkerUrl ?? '', { max: 3 });
  const withUserTx = createWithUserTx(() => serverDb);
  const withSystemTx = createWithSystemTx(() => workerDb);
  const withPlatformTx = createWithPlatformTx(() => workerDb);
  const tenant = randomUUID();
  const tag = tenant.slice(0, 8);
  const admin = { user: randomUUID(), person: randomUUID(), session: randomUUID() };
  const existing = { user: randomUUID(), person: randomUUID() };
  const department = randomUUID();
  const verified = brandVerifiedClaims({
    sub: admin.user,
    role: 'authenticated',
    aal: 'aal1',
    session_id: admin.session,
    tenant_id: tenant,
    person_id: admin.person,
  });
  if (!verified.ok || !hasTenant(verified.value)) throw new Error('bad fixture');
  const claims = verified.value;

  const objects = new Map<string, Uint8Array>();
  const storage: UserFileStorage = {
    createSignedUploadUrl: (_bucket, key) =>
      Promise.resolve({ url: `https://storage.test/upload/${key}?token=t`, token: 't' }),
    createSignedDownloadUrl: (bucket, key) =>
      Promise.resolve(`https://storage.test/${bucket}/${key}`),
  };
  const store: FileObjectStore = {
    read(_bucket, key) {
      const bytes = objects.get(key);
      return Promise.resolve(bytes ? { body: streamOf(bytes), size: bytes.length } : null);
    },
    move: () => Promise.resolve('moved'),
    remove: () => Promise.resolve(),
    // Storage's own insert into storage.objects comes with every object written.
    async write(bucket, key, bytes, contentType) {
      objects.set(key, bytes);
      await db.execute(sql`insert into storage.objects (bucket_id, name, metadata)
        values (${bucket}, ${key}, ${JSON.stringify({ size: bytes.length, mimetype: contentType })}::jsonb)`);
    },
  };
  const scanner: Scanner = {
    ping: () => Promise.resolve(),
    version: () =>
      Promise.resolve({ engine: 'ClamAV 1.5.4', signatures: '28137', signaturesDate: new Date() }),
    start: () =>
      Promise.resolve({
        write: () => Promise.resolve(),
        finish: () => Promise.resolve({ clean: true as const }),
        abort: () => undefined,
      }),
  };
  const logs: string[] = [];
  const log = (level: string, message: string) => logs.push(`${level}: ${message}`);
  const scan = createFileScanTask({ withPlatformTx, withSystemTx, store, scanner, log });
  const task = createUserImportTask({
    withPlatformTx,
    withSystemTx,
    files: createWorkerFiles({ store }),
    log,
    invitationPaceSeconds: 0,
  });
  const context = {
    ownTx: <T>(fn: Parameters<typeof withUserTx<T>>[1]) => withUserTx(claims, fn),
    storage,
  };

  /** The admin starts an import with `bytes`: upload intent, import, the browser's PUT, confirmation. */
  async function upload(bytes: Uint8Array, name: string, type: string): Promise<string> {
    const importId = randomUUID();
    const intent = await createUploadIntent(context, {
      purpose: 'platform.user_import',
      owner: { module: 'platform', entityType: 'user_import', entityId: importId },
      declaredName: name,
      size: bytes.length,
    });
    await withUserTx(claims, (tx) =>
      createUserImport(tx, {
        id: importId,
        fileId: intent.fileId,
        fileName: name,
        fileSize: bytes.length,
      }),
    );
    const [row] = await db.execute<{ object_key: string }>(
      sql`select object_key from platform.files where id = ${intent.fileId}::uuid`,
    );
    const key = row?.object_key ?? '';
    objects.set(key, bytes);
    await db.execute(sql`insert into storage.objects (bucket_id, name, owner, metadata)
      values ('imports', ${key}, ${admin.user},
              ${JSON.stringify({ size: bytes.length, mimetype: type })}::jsonb)`);
    await withUserTx(claims, (tx) => confirmUpload(tx, intent.fileId));
    return importId;
  }

  /** Scan and import passes until the import has the status (other organizations' work may come first). */
  async function until(importId: string, status: string) {
    for (let i = 0; i < 25; i += 1) {
      await scan.run({ jobId: randomUUID() });
      await task.run({ jobId: randomUUID() });
      const record = await withUserTx(claims, (tx) => getUserImport(tx, importId));
      if (record?.status === status) return record;
    }
    const record = await withUserTx(claims, (tx) => getUserImport(tx, importId));
    throw new Error(
      `import is ${record?.status ?? 'missing'} (${record?.failureCode ?? ''}), not ${status}; ${logs.slice(-6).join(' | ')}`,
    );
  }

  async function readCsv(bytes: Uint8Array) {
    const rows: string[][] = [];
    for await (const row of readCsvRows([bytes])) {
      rows.push([...row.cells]);
    }
    return rows;
  }

  beforeAll(async () => {
    await db.execute(sql`insert into platform.tenants (id, slug, name_ar, name_en, status)
      values (${tenant}, ${`import-${tag}`}, 'شركة الاستيراد', 'Import Company', 'active')`);
    await db.execute(sql`insert into auth.users (id, email) values
      (${admin.user}, ${`admin.${tag}@import.example`}), (${existing.user}, ${`old.${tag}@import.example`})`);
    await db.execute(sql`insert into platform.persons (id, tenant_id, display_name_ar, first_name_ar, family_name_ar, email) values
      (${admin.person}, ${tenant}, 'مدير المنشأة', 'مدير', 'المنشأة', ${`admin.${tag}@import.example`}),
      (${existing.person}, ${tenant}, 'خالد الشهري', 'خالد', 'الشهري', ${`old.${tag}@import.example`})`);
    await db.execute(sql`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
      (${tenant}, ${admin.user}, ${admin.person}, 'active'), (${tenant}, ${existing.user}, ${existing.person}, 'active')`);
    await db.execute(sql`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
      select tenant_id, id, case when user_id = ${admin.user}::uuid then 'tenant_admin' else 'learner' end, true
      from platform.tenant_memberships where tenant_id = ${tenant}::uuid`);
    await db.execute(sql`insert into platform.departments (id, tenant_id, code, name_ar, name_en)
      values (${department}, ${tenant}, 'SAL', 'المبيعات', 'Sales')`);
    await db.execute(
      sql`insert into auth.sessions (id, user_id) values (${admin.session}, ${admin.user})`,
    );
    await db.execute(sql`insert into platform.session_context (session_id, user_id, active_tenant_id)
      values (${admin.session}, ${admin.user}, ${tenant})`);
  });

  afterAll(async () => {
    await db.execute(sql`delete from storage.objects where name like ${`${tenant}/%`}`);
    await db.$client.end({ timeout: 5 });
    await serverDb.$client.end({ timeout: 5 });
    await workerDb.$client.end({ timeout: 5 });
  });

  it('CSV: read, mapping, dry run, run with invitations, error report, undo and purge', async () => {
    const csv = new TextEncoder().encode(
      CSV_BOM +
        csvLine(['Email', 'الاسم الأول', 'العائلة', 'الإدارة', 'المشرف', 'الدور', 'الجنسية']) +
        csvLine([
          `noura.${tag}@import.example`,
          'نورة',
          'الدوسري',
          'SAL',
          `old.${tag}@import.example`,
          'منسق التدريب',
          'سعودية',
        ]) +
        csvLine([
          `fahad.${tag}@import.example`,
          'فهد',
          'العتيبي',
          'التسويق',
          `noura.${tag}@import.example`,
          '',
          'سعودية',
        ]) +
        csvLine([`old.${tag}@import.example`, 'خالد', 'الشهراني', 'المبيعات', '', '', '']) +
        csvLine([
          `bad@`,
          'سارة',
          '=HYPERLINK("https://x.test")',
          '',
          '',
          'مدير الموارد البشرية',
          '',
        ]) +
        csvLine([`admin.${tag}@import.example`, 'مدير', 'المنشأة', '', '', '', '']),
    );
    const importId = await upload(csv, 'موظفو-الاستيراد.csv', 'text/csv');

    // Read: one sheet, its columns with samples — none for a column that is never imported.
    const read = await until(importId, 'mapping');
    expect(read.sheets).toEqual([{ name: '', rows: 5, columns: 7, hidden: false, headerRow: 1 }]);
    const columns = await withUserTx(claims, (tx) => listUserImportColumns(tx, importId));
    expect(columns.map((c) => c.header)).toEqual([
      'Email',
      'الاسم الأول',
      'العائلة',
      'الإدارة',
      'المشرف',
      'الدور',
      'الجنسية',
    ]);
    expect(columns[6]?.samples).toEqual([]);
    expect(columns[1]?.samples).toEqual(['نورة', 'فهد', 'خالد']);
    const recognized = recognizeColumns(columns);
    expect(recognized[4]).toEqual({ kind: 'suggested', field: 'manager_email', because: 'emails' });
    // The importer confirms the suggestion.
    const mapping = { ...proposedMapping(recognized), '4': 'manager_email' as const };

    await withUserTx(claims, (tx) =>
      chooseUserImportMapping(tx, importId, { sheetIndex: 0, mapping }),
    );
    const reviewed = await until(importId, 'review');
    expect(reviewed.rowsTotal).toBe(5);
    expect(reviewed.reviewCounts).toMatchObject({
      total: 5,
      new: 2,
      existing: 1,
      skipped: 1,
      errors: 1,
    });
    expect(reviewed.reviewCounts?.errorCodes).toEqual({ EMAIL_INVALID: 1, ROLE_PRIVILEGED: 1 });
    expect(reviewed.reviewCounts?.warningCodes).toEqual({ DEPARTMENT_NOT_FOUND: 1 });
    const errors = await withUserTx(claims, (tx) =>
      listUserImportRows(tx, importId, { view: 'errors', offset: 0, limit: 25 }),
    );
    expect(errors.rows.map((r) => r.rowNumber)).toEqual([5]);
    // The review's list of problems: our five columns, then the file's imported ones; formulas as text.
    expect(reviewed.reviewFileId).not.toBeNull();
    const [reviewKey] = await db.execute<{ object_key: string }>(
      sql`select object_key from platform.files where id = ${reviewed.reviewFileId}::uuid`,
    );
    const review = await readCsv(objects.get(reviewKey?.object_key ?? '') ?? new Uint8Array());
    expect(review[0]).toEqual([
      'الصف في الملف',
      'النتيجة',
      'السبب',
      'Reason',
      'رمز السبب',
      'Email',
      'الاسم الأول',
      'العائلة',
      'الإدارة',
      'المشرف',
      'الدور',
    ]);
    const errorLine = review.find((r) => r[0] === '5');
    expect(errorLine?.[4]).toBe('EMAIL_INVALID ROLE_PRIVILEGED');
    expect(errorLine?.[7]).toBe('\'=HYPERLINK("https://x.test")');
    expect(unneutralizeFormula(errorLine?.[7] ?? '')).toBe('=HYPERLINK("https://x.test")');

    // Confirm: add and update, send invitations; the run adds managers first.
    await withUserTx(claims, (tx) =>
      confirmUserImport(tx, importId, {
        existing: 'upsert',
        defaultRole: 'learner',
        invitations: 'send',
      }),
    );
    const finished = await until(importId, 'finished');
    expect(finished.resultCounts).toMatchObject({ added: 2, updated: 1, skipped: 1, failed: 1 });
    const people = await db.execute<{
      email: string;
      manager: string | null;
      department_id: string | null;
    }>(sql`
      select p.email, m.email as manager, e.department_id
      from platform.persons p
      join platform.person_employment e on e.tenant_id = p.tenant_id and e.person_id = p.id
      left join platform.persons m on m.tenant_id = e.tenant_id and m.id = e.manager_person_id
      where p.tenant_id = ${tenant}::uuid and p.email like ${`%.${tag}@import.example`}
      order by p.email`);
    expect(people.find((p) => p.email.startsWith('noura'))).toMatchObject({
      manager: `old.${tag}@import.example`,
      department_id: department,
    });
    expect(people.find((p) => p.email.startsWith('fahad'))).toMatchObject({
      manager: `noura.${tag}@import.example`,
      department_id: null,
    });
    const [updated] = await db.execute<{ family_name_ar: string }>(
      sql`select family_name_ar from platform.persons where id = ${existing.person}::uuid`,
    );
    expect(updated?.family_name_ar).toBe('الشهراني');

    // Invitations: held, scheduled at once (pace 0), then released for the mailer.
    for (let i = 0; i < 5; i += 1) await task.run({ jobId: randomUUID() });
    const invitations = await db.execute<{
      mail_held: boolean;
      send_at: Date | null;
      invited_by: string;
      primary_role: string;
    }>(
      sql`select mail_held, send_at, invited_by, primary_role from platform.invitations where import_id = ${importId}::uuid order by primary_role`,
    );
    expect(invitations).toHaveLength(2);
    expect(
      invitations.every((v) => !v.mail_held && v.send_at === null && v.invited_by === admin.user),
    ).toBe(true);
    expect(invitations.map((v) => v.primary_role)).toEqual(['learner', 'training_coordinator']);
    const [released] = await db.execute<{
      n: string;
    }>(sql`select count(*) as n from platform.event_outbox
      where tenant_id = ${tenant}::uuid and type = 'com.entlaqa.platform.invitation.released' and actor_type = 'system'`);
    expect(Number(released?.n)).toBe(2);

    // The error report: the row not imported and the skipped one; kept 7 days (used).
    const [report] = await db.execute<{ object_key: string; used_at: Date | null }>(
      sql`select object_key, used_at from platform.files where id = ${finished.reportFileId}::uuid`,
    );
    expect(report?.used_at).not.toBeNull();
    const lines = await readCsv(objects.get(report?.object_key ?? '') ?? new Uint8Array());
    expect(lines.slice(1).map((r) => [r[0], r[1], r[4]])).toEqual([
      ['3', 'أُضيف مع تنبيه', 'DEPARTMENT_NOT_FOUND'],
      ['5', 'لم يُستورد', 'EMAIL_INVALID ROLE_PRIVILEGED'],
      ['6', 'تُخطّي', 'OWN_ROW'],
    ]);
    const [audit] = await db.execute<{
      n: string;
    }>(sql`select count(*) as n from platform.audit_events
      where tenant_id = ${tenant}::uuid and action = 'platform.user_import.finished' and entity_id = ${importId}`);
    expect(Number(audit?.n)).toBe(1);

    // Undo: the people who did not accept are removed (invitation revoked, record inactive); the
    // updated member gets their previous values back.
    await withUserTx(claims, (tx) => requestUserImportUndo(tx, importId, 'wrong_file'));
    const undone = await until(importId, 'undone');
    expect(undone.undoReason).toBe('wrong_file');
    const after = await db.execute<{
      status: string;
      family_name_ar: string | null;
      email: string;
    }>(sql`
      select status, family_name_ar, email from platform.persons
      where tenant_id = ${tenant}::uuid and email like ${`%.${tag}@import.example`} order by email`);
    expect(after.find((p) => p.email.startsWith('old'))?.family_name_ar).toBe('الشهري');
    expect(
      after
        .filter((p) => p.email.startsWith('noura') || p.email.startsWith('fahad'))
        .map((p) => p.status),
    ).toEqual(['inactive', 'inactive']);
    const [revoked] = await db.execute<{
      n: string;
    }>(sql`select count(*) as n from platform.invitations
      where import_id = ${importId}::uuid and status = 'revoked' and revoked_by = ${admin.user}::uuid`);
    expect(Number(revoked?.n)).toBe(2);

    // 7 days later: files and staged data deleted; the import record stays.
    await db.execute(sql`alter table platform.user_imports disable trigger user_imports_check`);
    await db.execute(sql`update platform.user_imports set undone_at = now() - interval '8 days',
      finished_at = now() - interval '8 days' where id = ${importId}::uuid`);
    await db.execute(sql`alter table platform.user_imports enable trigger user_imports_check`);
    for (let i = 0; i < 5; i += 1) await task.run({ jobId: randomUUID() });
    const purged = await withUserTx(claims, (tx) => getUserImport(tx, importId));
    expect(purged?.dataPurgedAt).not.toBeNull();
    const [staged] = await db.execute<{ n: string }>(
      sql`select (select count(*) from platform.user_import_rows where import_id = ${importId}::uuid)
               + (select count(*) from platform.user_import_columns where import_id = ${importId}::uuid) as n`,
    );
    expect(Number(staged?.n)).toBe(0);
    const files = await db.execute<{ status: string }>(sql`select status from platform.files
      where id in (${purged?.fileId}::uuid, ${purged?.reviewFileId}::uuid, ${purged?.reportFileId}::uuid)`);
    expect(files.every((f) => f.status === 'deleted')).toBe(true);

    // No file content in the logs.
    const logged = logs.join('\n');
    for (const value of ['نورة', 'noura', 'HYPERLINK', 'الشهراني', 'موظفو'])
      expect(logged).not.toContain(value);
  });

  it('XLSX: sheets read from the workbook; cancelled before the run, then deleted', async () => {
    const xlsx = writeXlsx([
      {
        name: 'الموظفون',
        rightToLeft: true,
        columns: [],
        rows: [
          ['البريد الإلكتروني للعمل', 'الاسم الأول', 'اسم العائلة'],
          [`x.${tag}@import.example`, 'سلمى', 'الحربي'],
        ],
      },
      { name: 'ملخص', rightToLeft: true, columns: [], rows: [['عدد'], ['1']] },
    ]);
    const importId = await upload(
      xlsx,
      'موظفون.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const read = await until(importId, 'mapping');
    expect(read.sheets.map((s) => [s.name, s.rows, s.columns])).toEqual([
      ['الموظفون', 1, 3],
      ['ملخص', 1, 1],
    ]);
    await withUserTx(claims, (tx) => cancelUserImport(tx, importId));
    for (let i = 0; i < 5; i += 1) await task.run({ jobId: randomUUID() });
    const cancelled = await withUserTx(claims, (tx) => getUserImport(tx, importId));
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.dataPurgedAt).not.toBeNull();
  });

  it('held invitations: kept «لم تُرسل الدعوة» until sent from the list', async () => {
    const csv = new TextEncoder().encode(
      CSV_BOM +
        csvLine(['Email', 'الاسم الأول', 'اسم العائلة']) +
        csvLine([`held.${tag}@import.example`, 'هند', 'العنزي']),
    );
    const importId = await upload(csv, 'لاحقًا.csv', 'text/csv');
    const read = await until(importId, 'mapping');
    expect(read.status).toBe('mapping');
    await withUserTx(claims, (tx) =>
      chooseUserImportMapping(tx, importId, {
        sheetIndex: 0,
        mapping: { '0': 'email', '1': 'first_name_ar', '2': 'family_name_ar' },
      }),
    );
    await until(importId, 'review');
    await withUserTx(claims, (tx) =>
      confirmUserImport(tx, importId, {
        existing: 'skip',
        defaultRole: 'learner',
        invitations: 'hold',
      }),
    );
    const finished = await until(importId, 'finished');
    expect(finished.invitations).toEqual({ held: 1, scheduled: 0, sent: 0, accepted: 0 });
    const scheduled = await withUserTx(claims, (tx) =>
      scheduleHeldInvitations(tx, { importId }, 0),
    );
    expect(scheduled).toBe(1);
    for (let i = 0; i < 5; i += 1) await task.run({ jobId: randomUUID() });
    const sent = await withUserTx(claims, (tx) => getUserImport(tx, importId));
    expect(sent?.invitations).toEqual({ held: 0, scheduled: 0, sent: 1, accepted: 0 });
  });
});
