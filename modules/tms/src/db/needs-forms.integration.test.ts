/**
 * Needs forms against PostgreSQL under withUserTx (T-M3-10; migrations 20261020180200…180400): the data access
 * the actions use, as the L&D Manager of a fresh organization — the seeded default form, create, write
 * sections and fields (options, condition), order, default, duplicate, rename with a version, the lock (a
 * database refusal mapped), delete.
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { type UserTx, createDatabase, createWithUserTx } from '@jadarat/platform-db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyFormChange } from '../needs-forms/rules';
import * as db from './needs-forms';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('needs forms against PostgreSQL', () => {
  const owner = createDatabase(ownerUrl ?? '', { max: 1 });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const tenant = randomUUID();
  const lnd = { user: randomUUID(), session: randomUUID(), person: randomUUID() };
  const claims = () => {
    const r = brandVerifiedClaims({
      sub: lnd.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: lnd.session,
      tenant_id: tenant,
      person_id: lnd.person,
    });
    if (!r.ok) throw new Error('bad fixture');
    return r.value;
  };
  const as = <T>(fn: (tx: UserTx) => Promise<T>) => withUserTx(claims(), fn);
  const newId = () => randomUUID();

  beforeAll(async () => {
    await owner.execute(sql`insert into platform.tenants (id, slug, name_ar, status)
      values (${tenant}::uuid, ${`nf-${tenant.slice(0, 8)}`}, 'منشأة', 'active')`);
    await owner.execute(
      sql`insert into auth.users (id, email) values (${lnd.user}::uuid, ${`${lnd.user}@example.test`})`,
    );
    await owner.execute(
      sql`insert into auth.sessions (id, user_id) values (${lnd.session}::uuid, ${lnd.user}::uuid)`,
    );
    await owner.execute(sql`insert into platform.persons (id, tenant_id, display_name_ar)
      values (${lnd.person}::uuid, ${tenant}::uuid, 'مدير التعلم')`);
    await owner.execute(sql`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
      values (${tenant}::uuid, ${lnd.user}::uuid, ${lnd.person}::uuid, 'active')`);
    await owner.execute(sql`insert into platform.session_context (session_id, user_id, active_tenant_id)
      values (${lnd.session}::uuid, ${lnd.user}::uuid, ${tenant}::uuid)`);
    await owner.execute(sql`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
      select tenant_id, id, 'training_manager', true from platform.tenant_memberships where user_id = ${lnd.user}::uuid`);
  });

  afterAll(async () => {
    await owner.$client.end();
    await serverDb.$client.end();
  });

  it('lists the seeded default form and reads it whole', async () => {
    const forms = await as((tx) => db.listNeedsForms(tx));
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatchObject({
      isDefault: true,
      isActive: true,
      lockedAt: null,
      sectionCount: 1,
      // Nine since WP-LD-01: the estimated cost is a column of the need, no longer a seeded field.
      fieldCount: 9,
    });
    const form = await as((tx) => db.getNeedsForm(tx, forms[0]?.id ?? ''));
    expect(form?.sections[0]?.fields.map((f) => f.systemKey ?? f.type)).toEqual([
      'training_topic',
      'textarea',
      'select',
      'select',
      'people',
      'select',
      'select',
      'textarea',
      'select',
    ]);
    expect(form?.sections[0]?.fields[2]?.options[0]).toEqual({
      value: 'technical',
      label: { en: 'Technical', ar: 'تقني' },
    });
    expect(await as((tx) => db.getNeedsForm(tx, randomUUID()))).toBeNull();
  });

  it('creates, builds, orders, duplicates, renames, locks and deletes a form', async () => {
    const formId = await as((tx) =>
      db.createNeedsForm(tx, { nameEn: 'Engineering', nameAr: 'الهندسة' }),
    );
    // A dropdown and a field shown on one of its answers, through the builder's rules.
    const built = await as(async (tx) => {
      const before = await db.getNeedsForm(tx, formId, { forUpdate: true });
      if (!before) throw new Error('missing');
      const sectionId = before.sections[0]?.id ?? '';
      const withLevel = applyFormChange(
        before,
        {
          kind: 'saveField',
          input: {
            formId,
            sectionId,
            type: 'select',
            labelEn: 'Level',
            labelAr: 'المستوى',
            placeholderEn: null,
            placeholderAr: null,
            required: false,
            options: [
              { labelEn: 'Basic', labelAr: 'أساسي' },
              { labelEn: 'Advanced', labelAr: 'متقدم' },
            ],
            peopleMode: null,
            condition: null,
          },
        },
        newId,
      );
      if (!withLevel.ok) throw new Error('rules');
      const level = withLevel.value.sections[0]?.fields.at(-1);
      if (!level) throw new Error('level');
      await db.writeField(tx, formId, sectionId, level, true);
      const withDetails = applyFormChange(
        withLevel.value,
        {
          kind: 'saveField',
          input: {
            formId,
            sectionId,
            type: 'textarea',
            labelEn: 'Details',
            labelAr: 'التفاصيل',
            placeholderEn: 'More',
            placeholderAr: null,
            required: true,
            options: [],
            peopleMode: null,
            condition: { fieldId: level.id, value: 'advanced' },
          },
        },
        newId,
      );
      if (!withDetails.ok) throw new Error('rules');
      const details = withDetails.value.sections[0]?.fields.at(-1);
      if (!details) throw new Error('details');
      await db.writeField(tx, formId, sectionId, details, true);
      await db.orderFields(tx, sectionId, [
        level.id,
        ...(before.sections[0]?.fields.map((f) => f.id) ?? []),
        details.id,
      ]);
      const extra = {
        id: randomUUID(),
        name: { en: 'Context', ar: 'السياق' },
        description: { en: 'Why' },
        repeatable: true,
        minEntries: 0,
        maxEntries: 5,
        visible: true,
        fields: [],
      };
      await db.writeSection(tx, formId, extra, true);
      await db.writeSection(tx, formId, { ...extra, visible: false }, false);
      await db.orderSections(tx, formId, [extra.id, sectionId]);
      return db.getNeedsForm(tx, formId);
    });
    expect(built?.sections.map((s) => [s.name.en, s.visible, s.maxEntries])).toEqual([
      ['Context', false, 5],
      ['Training needs', true, 50],
    ]);
    expect(built?.sections[1]?.fields.map((f) => f.label.en)).toEqual([
      'Level',
      'Training topic',
      'People',
      'Details',
    ]);
    expect(built?.sections[1]?.fields[3]).toMatchObject({
      condition: { value: 'advanced' },
      placeholder: { en: 'More' },
      required: true,
    });

    const copyId = await as((tx) =>
      db.duplicateNeedsForm(tx, formId, { nameEn: 'Engineering copy', nameAr: 'نسخة الهندسة' }),
    );
    const copy = await as((tx) => db.getNeedsForm(tx, copyId ?? ''));
    const copyLevel = copy?.sections[1]?.fields[0];
    expect(copy?.sections[1]?.fields[3]?.condition).toEqual({
      fieldId: copyLevel?.id,
      value: 'advanced',
    });

    await as((tx) =>
      db.renameNeedsForm(tx, formId, built?.version ?? 0, {
        nameEn: 'Engineering 2027',
        nameAr: 'الهندسة 2027',
      }),
    );
    await expect(
      as((tx) => db.renameNeedsForm(tx, formId, 1, { nameEn: 'Old', nameAr: 'قديم' })),
    ).rejects.toMatchObject({ refusal: 'version_conflict' });
    const taken = await as((tx) =>
      db.renameNeedsForm(tx, copyId ?? '', copy?.version ?? 0, {
        nameEn: 'ENGINEERING 2027',
        nameAr: 'فريد',
      }),
    ).then(
      () => 'saved',
      (e: unknown) => db.needsFormRefusalOf(e),
    );
    expect(taken).toBe('name_en_taken');

    await as((tx) => db.setDefaultNeedsForm(tx, formId));
    const forms = await as((tx) => db.listNeedsForms(tx));
    expect(forms.filter((f) => f.isDefault).map((f) => f.id)).toEqual([formId]);
    await as((tx) => db.setNeedsFormActive(tx, copyId ?? '', false));
    expect((await as((tx) => db.listNeedsForms(tx))).find((f) => f.id === copyId)?.isActive).toBe(
      false,
    );

    // The cycle launch locks it: the structure is frozen (a database refusal, mapped).
    await as((tx) => tx.execute(sql`select private.lock_needs_form(${copyId}::uuid)`));
    const locked = await as((tx) => db.deleteField(tx, copyId ?? '', copyLevel?.id ?? '')).then(
      () => 'deleted',
      (e: unknown) => db.needsFormRefusalOf(e),
    );
    expect(locked).toBe('locked');
    const lockedDelete = await as((tx) => db.deleteNeedsForm(tx, copyId ?? '')).then(
      () => 'deleted',
      (e: unknown) => db.needsFormRefusalOf(e),
    );
    expect(lockedDelete).toBe('locked');
    const defaultDelete = await as((tx) => db.deleteNeedsForm(tx, formId)).then(
      () => 'deleted',
      (e: unknown) => db.needsFormRefusalOf(e),
    );
    expect(defaultDelete).toBe('default');

    const other = await as((tx) => db.createNeedsForm(tx, { nameEn: 'Scratch', nameAr: 'مسودة' }));
    // A planning cycle (even a draft) that uses the form keeps it from being deleted (migration 20261020190000).
    const [cycle] = await as((tx) =>
      tx.execute<{ id: string }>(sql`
        insert into tms.plan_cycles (name_ar, name_en, period_start_on, period_end_on, deadline_on, needs_form_id)
        values ('خطة', 'Plan', current_date, current_date + 300, current_date + 10, ${other}::uuid)
        returning id`),
    );
    const inUse = await as((tx) => db.deleteNeedsForm(tx, other)).then(
      () => 'deleted',
      (e: unknown) => db.needsFormRefusalOf(e),
    );
    expect(inUse).toBe('in_use');
    await as((tx) =>
      tx.execute(sql`delete from tms.plan_cycles where id = ${cycle?.id ?? ''}::uuid`),
    );
    await as((tx) => db.deleteNeedsForm(tx, other));
    expect(await as((tx) => db.getNeedsForm(tx, other))).toBeNull();
    await expect(as((tx) => db.deleteNeedsForm(tx, other))).rejects.toMatchObject({
      refusal: 'not_found',
    });
    await expect(as((tx) => db.setDefaultNeedsForm(tx, other))).rejects.toMatchObject({
      refusal: 'not_found',
    });
    await expect(as((tx) => db.setNeedsFormActive(tx, other, true))).rejects.toMatchObject({
      refusal: 'not_found',
    });
    await expect(
      as((tx) => db.renameNeedsForm(tx, other, 1, { nameEn: 'x', nameAr: 'س' })),
    ).rejects.toMatchObject({ refusal: 'not_found' });
    expect(() => db.needsFormRefusalOf(new Error('other'))).toThrow('other');
  });
});
