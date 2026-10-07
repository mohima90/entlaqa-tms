import { describe, expect, it } from 'vitest';
import type { InvitationListItem } from './invite-form';
import { expiryFrom, filterInvitations, foldSearchText } from './invitations-view';

const row = (over: Partial<InvitationListItem>): InvitationListItem => ({
  id: 'i',
  personId: 'p',
  email: 'n.aldossari@alraya.example',
  displayNameAr: 'نورة فهد الدوسري',
  displayNameEn: 'Noura Aldossari',
  primaryRole: 'training_coordinator',
  state: 'pending',
  sendCount: 1,
  ...over,
});
const rows = [
  row({ id: 'a' }),
  row({
    id: 'b',
    email: 'ahmed@trainpro.example',
    displayNameAr: 'أحمد حسن',
    displayNameEn: null,
    primaryRole: 'external_instructor',
    state: 'expired',
  }),
];

describe('foldSearchText', () => {
  it('folds case, digits, harakat, hamza forms, teh marbuta and alef maqsura', () => {
    expect(foldSearchText('  EMP-١٤٥٠ ')).toBe('emp-1450');
    expect(foldSearchText('أحمد  إبراهيم آل مُصطفى')).toBe('احمد ابراهيم ال مصطفي');
    expect(foldSearchText('نورة')).toBe('نوره');
  });
});

describe('filterInvitations', () => {
  it('searches names in both languages and the e-mail', () => {
    const ids = (filter: Parameters<typeof filterInvitations>[1]) =>
      filterInvitations(rows, filter).map((r) => r.id);
    expect(ids({})).toEqual(['a', 'b']);
    expect(ids({ q: 'نوره' })).toEqual(['a']);
    expect(ids({ q: 'احمد' })).toEqual(['b']);
    expect(ids({ q: 'NOURA' })).toEqual(['a']);
    expect(ids({ q: 'trainpro' })).toEqual(['b']);
    expect(ids({ role: 'external_instructor' })).toEqual(['b']);
    expect(ids({ q: 'noura', role: 'external_instructor' })).toEqual([]);
    // Invitations carry no department or branch: such filters match none.
    expect(ids({ department: 'd1' })).toEqual([]);
    expect(ids({ branch: 'b1' })).toEqual([]);
  });
});

describe('expiryFrom', () => {
  it('adds the validity days', () => {
    const now = new Date('2026-10-04T09:00:00Z');
    expect(expiryFrom(now).toISOString()).toBe('2026-10-11T09:00:00.000Z');
    expect(expiryFrom(now, 1).toISOString()).toBe('2026-10-05T09:00:00.000Z');
  });
});
