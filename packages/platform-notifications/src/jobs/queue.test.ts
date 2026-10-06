import type { SystemTx } from '@jadarat/platform-db/jobs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queueEmail } from './queue';
import { EMAIL_QUEUED_EVENT } from './sender';

const db = vi.hoisted(() => ({ insertEmailDelivery: vi.fn(), emitEvent: vi.fn() }));
vi.mock('@jadarat/platform-db/jobs', () => ({ insertEmailDelivery: db.insertEmailDelivery }));
vi.mock('@jadarat/platform-db', () => ({ emitEvent: db.emitEvent }));

const tx = {} as SystemTx;
const variables = {
  recipientName: { ar: 'نورة', en: 'Noura' },
  inviterName: { ar: 'محمد', en: 'Mohammed' },
  organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
  roleName: { ar: 'متدرب', en: 'Learner' },
  acceptUrl: 'https://raya.example/ar/invite/accept?token=t',
  expiresAt: '2026-10-11T09:00:00+03:00',
  timeZone: 'Asia/Riyadh',
  loginEmail: 'sara@example.com',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('queueEmail', () => {
  it('renders, records the delivery with a masked address, and emits the queued event', async () => {
    db.insertEmailDelivery.mockResolvedValue('d1');
    const id = await queueEmail(tx, {
      template: 'platform.invitation',
      locale: 'ar',
      to: 'sara@example.com',
      variables,
      recipientPersonId: 'p1',
      sourceEventId: 'e1',
    });
    expect(id).toBe('d1');
    expect(db.insertEmailDelivery).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        template: 'platform.invitation',
        templateVersion: 1,
        locale: 'ar',
        recipientPersonId: 'p1',
        destination: 'sara@example.com',
        destinationMasked: 's***@example.com',
        subject: 'دعوة للانضمام إلى نظام التدريب في شركة الراية',
        sourceEventId: 'e1',
      }),
    );
    expect(db.emitEvent).toHaveBeenCalledWith(tx, {
      type: EMAIL_QUEUED_EVENT,
      subject: 'd1',
      data: { template: 'platform.invitation' },
    });
  });

  it('refuses a bad address or bad variables before writing anything', async () => {
    await expect(
      queueEmail(tx, {
        template: 'platform.invitation',
        locale: 'ar',
        to: 'x\nBcc: y@z.co',
        variables,
      }),
    ).rejects.toThrow('invalid recipient');
    await expect(
      queueEmail(tx, {
        template: 'platform.invitation',
        locale: 'en',
        to: 'sara@example.com',
        variables: { ...variables, acceptUrl: 'javascript:alert(1)' },
      }),
    ).rejects.toThrow();
    expect(db.insertEmailDelivery).not.toHaveBeenCalled();
    expect(db.emitEvent).not.toHaveBeenCalled();
  });
});
