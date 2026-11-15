import { displayDateFormatter } from '@jadarat/platform-i18n';
import type { PlanApprovalView } from '@jadarat/tms';
import { describe, expect, it } from 'vitest';
import {
  approvalMoments,
  approvalReviewHref,
  decidersLabel,
  personLabel,
  planVersionHref,
  stepDeciderWarning,
} from './plan-approval-view';

const person = (personId: string, ar: string | null, en: string | null) => ({
  personId,
  name: { ar, en },
});

describe('plan approval view helpers (WP-LD-03)', () => {
  it('builds the addresses of the review and of a version', () => {
    expect(approvalReviewHref('ar', 'c1')).toBe('/ar/suite/approvals/c1');
    expect(planVersionHref('en', 'c1', 2)).toBe('/en/suite/planning/cycles/c1/versions/2');
  });

  it('names a person in the page language first, the other one otherwise, or the fallback', () => {
    expect(personLabel('en', person('p', 'خالد', 'Khalid'), '—')).toBe('Khalid');
    expect(personLabel('en', person('p', 'خالد', null), '—')).toBe('خالد');
    expect(personLabel('ar', person('p', null, 'Khalid'), '—')).toBe('Khalid');
    expect(personLabel('ar', null, 'أحدهم')).toBe('أحدهم');
    expect(personLabel('ar', person('p', null, null), 'أحدهم')).toBe('أحدهم');
  });

  it('joins the deciders and marks the viewer', () => {
    const people = [person('a', null, 'Khalid Omar'), person('b', null, 'Mona Adel')];
    expect(decidersLabel('en', people, ' or ')).toBe('Khalid Omar or Mona Adel');
    expect(decidersLabel('en', people, ' or ', 'a', (n) => `${n} (you)`)).toBe(
      'Khalid Omar (you) or Mona Adel',
    );
    expect(decidersLabel('en', [], ' or ')).toBe('');
  });

  it('formats every moment of an approval once', () => {
    const view = {
      plan: {
        submittedAt: '2026-11-15T08:00:00.000Z',
        decidedAt: null,
        approvedAt: '2026-11-16T09:00:00.000Z',
      },
      steps: {
        hr: { decidedAt: '2026-11-15T10:00:00.000Z' },
        finance: { decidedAt: null },
      },
      events: [{ at: '2026-11-15T08:00:00.000Z' }],
      versions: [{ approvedAt: '2026-11-16T09:00:00.000Z' }],
    } as unknown as PlanApprovalView;
    const moments = approvalMoments(view, displayDateFormatter('en', 'gregorian', 'Asia/Riyadh'));
    expect(Object.keys(moments).sort()).toEqual([
      '2026-11-15T08:00:00.000Z',
      '2026-11-15T10:00:00.000Z',
      '2026-11-16T09:00:00.000Z',
    ]);
    expect(moments['2026-11-15T08:00:00.000Z']).toMatch(/2026/);
    expect(approvalMoments(null, displayDateFormatter('en', 'gregorian', 'UTC'))).toEqual({});
  });

  it('warns when nobody but the submitting viewer could decide a step (review M2)', () => {
    const me = person('me', 'أنا', 'Me');
    const other = person('other', 'منى', 'Mona');
    expect(stepDeciderWarning([], 'me')).toBe('nobody');
    expect(stepDeciderWarning([me], 'me')).toBe('onlyYou');
    expect(stepDeciderWarning([me, other], 'me')).toBeNull();
    expect(stepDeciderWarning([other], 'me')).toBeNull();
    expect(stepDeciderWarning([me], null)).toBeNull();
  });
});
