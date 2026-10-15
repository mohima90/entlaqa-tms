/**
 * Every time zone the organization profile offers is one the database accepts (T-M2-22 review M1): the
 * stamping trigger of platform.tenant_settings refuses zones PostgreSQL does not know, and distributions
 * now ship tzdata's legacy link names separately (tzdata-legacy). Runs against the CI PostgreSQL.
 */
import { COUNTRY_PRESETS, ianaTimeZones } from '@jadarat/platform-i18n';
import { createDatabase } from '@jadarat/platform-db';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

const ownerUrl = process.env.TEST_DATABASE_URL;
const configured = Boolean(ownerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL must be set');
}

describe.skipIf(!configured)('organization profile time zones against PostgreSQL', () => {
  const db = createDatabase(ownerUrl ?? '', { max: 1 });

  afterAll(async () => {
    await db.$client.end();
  });

  it('accepts every offered zone and every preset zone', async () => {
    const rows = await db.execute<{ name: string }>(
      sql`select name from pg_catalog.pg_timezone_names`,
    );
    const known = new Set(rows.map((row) => row.name));
    const offered = [
      ...ianaTimeZones(),
      ...Object.values(COUNTRY_PRESETS).map((preset) => preset.timeZone),
    ];
    expect(offered.filter((zone) => !known.has(zone))).toEqual([]);
  });
});
