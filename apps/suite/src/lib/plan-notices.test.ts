import type { OrganizationPlan } from '@jadarat/platform-db';
import { describe, expect, it } from 'vitest';
import { planNotices } from './plan-notices';

const base: OrganizationPlan = {
  hasPlan: true,
  planName: 'Team',
  planDescription: null,
  status: 'active',
  trialEndsAt: null,
  maxPeople: 200,
  peopleUsed: 100,
  maxStorageGb: 10,
  storageUsedBytes: 1024 ** 3,
  features: [],
};

describe('planNotices (WP-ADM-06): the home page warns from 90% of a limit', () => {
  it('nothing below 90% or without limits', () => {
    expect(planNotices(base)).toEqual([]);
    expect(planNotices({ ...base, maxPeople: null, maxStorageGb: null, peopleUsed: 5000 })).toEqual(
      [],
    );
  });

  it('people from 90%, reached at 100%', () => {
    expect(planNotices({ ...base, peopleUsed: 182 })).toEqual([
      { kind: 'people', reached: false, used: '182', limit: '200', percent: '91' },
    ]);
    expect(planNotices({ ...base, peopleUsed: 200 })[0]?.reached).toBe(true);
  });

  it('storage from 90%', () => {
    expect(planNotices({ ...base, storageUsedBytes: 9.5 * 1024 ** 3 })).toEqual([
      { kind: 'storage', reached: false, used: '9.5', limit: '10', percent: '95' },
    ]);
  });
});
