import { createPermissionRegistry, getSystemRole } from '@jadarat/platform-rbac';
import { describe, expect, it } from 'vitest';
import { SessionDraftInput, buildSessionDraft, tmsNavigation, tmsPermissions } from './index';

const input = {
  courseId: '55555555-5555-4555-8555-555555555555',
  titleAr: 'مهارات القيادة',
  deliveryType: 'classroom' as const,
  startsAt: '2026-10-05T09:00:00+03:00',
  endsAt: '2026-10-05T15:00:00+03:00',
  capacity: 20,
};

describe('tms permissions', () => {
  it('are namespaced under tms and registrable', () => {
    const registry = createPermissionRegistry(tmsPermissions);
    expect(registry.all().every((p) => p.code.startsWith('tms.'))).toBe(true);
    expect(registry.has('tms.enrollment.approve')).toBe(true);
  });

  it('are never granted to the Organization Admin, a setup role (BRD v2.4 Appendix B, BR-IAM-4)', () => {
    const tms = new Set(Object.keys(tmsPermissions));
    const granted = getSystemRole('tenant_admin').grants.map((g) => g.permission.code);
    expect(granted.filter((code) => tms.has(code) || code.startsWith('tms.'))).toEqual([]);
  });
});

describe('buildSessionDraft', () => {
  it('builds a draft with its duration', () => {
    const result = buildSessionDraft(SessionDraftInput.parse(input));
    expect(result.ok && result.value.durationMinutes).toBe(360);
    expect(result.ok && result.value.status).toBe('draft');
  });

  it('rejects sessions that end before they start or last longer than 90 days', () => {
    const inverted = buildSessionDraft({ ...input, endsAt: '2026-10-05T08:00:00+03:00' });
    expect(!inverted.ok && inverted.error.code).toBe('VALIDATION_FAILED');
    expect(!inverted.ok && inverted.error.status).toBe(422);
    expect(!inverted.ok && inverted.error.fieldErrors).toEqual([
      { path: 'endsAt', code: 'BEFORE_START' },
    ]);
    const tooLong = buildSessionDraft({ ...input, endsAt: '2027-03-05T08:00:00+03:00' });
    expect(!tooLong.ok && tooLong.error.fieldErrors).toEqual([
      { path: 'endsAt', code: 'TOO_LONG', params: { maximumDays: 90 } },
    ]);
  });

  it('validates untrusted input with zod', () => {
    expect(SessionDraftInput.safeParse({ ...input, capacity: 0 }).success).toBe(false);
    expect(SessionDraftInput.safeParse({ ...input, titleAr: ' ' }).success).toBe(false);
    expect(SessionDraftInput.safeParse({ ...input, courseId: '1 or 1=1' }).success).toBe(false);
  });
});

describe('tms navigation', () => {
  it('registers real URL prefixes under /suite', () => {
    expect(tmsNavigation.every((item) => item.href.startsWith('/suite'))).toBe(true);
  });
});
