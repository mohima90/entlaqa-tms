import { describe, expect, it } from 'vitest';
import { asksPlanDelivery } from './plan-delivery-shown';

describe('asksPlanDelivery (WP-LD-04 review L1)', () => {
  it('asks once the plan was approved, also while a revision is edited', () => {
    expect(asksPlanDelivery(null)).toBe(false);
    expect(asksPlanDelivery(undefined)).toBe(false);
    expect(asksPlanDelivery({ status: 'draft', planVersion: 1 })).toBe(false);
    expect(asksPlanDelivery({ status: 'in_approval', planVersion: 1 })).toBe(true);
    expect(asksPlanDelivery({ status: 'approved', planVersion: 1 })).toBe(true);
    // Revised: a draft again, version 2 — its drafts stay, so «Courses and sessions» stays.
    expect(asksPlanDelivery({ status: 'draft', planVersion: 2 })).toBe(true);
    expect(asksPlanDelivery({ status: 'sent_back', planVersion: 2 })).toBe(true);
  });
});
