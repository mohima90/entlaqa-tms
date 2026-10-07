import type { SystemTx } from '@jadarat/platform-db/jobs';
import {
  type TransactionalSubscriber,
  createSubscriberRegistry,
} from '@jadarat/platform-jobs/jobs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribers } from './subscribers';

const db = vi.hoisted(() => ({
  loadInvitationForMail: vi.fn(),
  issueInvitationToken: vi.fn(),
  invitationActorMayManage: vi.fn(),
}));
const mail = vi.hoisted(() => ({ queueEmail: vi.fn() }));
vi.mock('@jadarat/platform-db/jobs', () => db);
vi.mock('@jadarat/platform-notifications/jobs', async (original) => ({
  ...(await original<object>()),
  queueEmail: mail.queueEmail,
}));

const deps = {
  emailTransport: null,
  emailFrom: { name: 'Jadarat', address: 'noreply@jadarat.example' },
  log: vi.fn(),
};

afterEach(() => {
  vi.resetAllMocks();
});

describe('worker subscribers', () => {
  it('registers the e-mail sender and, with a web app origin, the invitation mailer', () => {
    const registry = createSubscriberRegistry(
      subscribers({ ...deps, appBaseUrl: 'https://tms.example.com' }),
    );
    expect(registry.names).toEqual(['notifications.email', 'platform.invitations.mailer']);
    expect(registry.forType('com.entlaqa.platform.invitation.resend_requested')).toHaveLength(1);
  });

  it('without an origin (e-mail switched off) invitations are not mailed', () => {
    const registry = createSubscriberRegistry(subscribers({ ...deps, appBaseUrl: undefined }));
    expect(registry.names).toEqual(['notifications.email']);
  });

  it("gives the mailer the system role's names, and refuses an unknown role", async () => {
    const mailer = subscribers({ ...deps, appBaseUrl: 'https://tms.example.com' })[1] as
      TransactionalSubscriber | undefined;
    const invitation = {
      id: 'i1',
      status: 'pending',
      sendCount: 0,
      email: 'sara@example.com',
      locale: 'ar',
      personId: 'p1',
      recipientName: { ar: 'سارة', en: null },
      inviterName: { ar: 'محمد', en: null },
      organizationName: { ar: 'شركة الراية', en: null },
      primaryRole: 'learner',
    };
    db.invitationActorMayManage.mockResolvedValue(true);
    db.loadInvitationForMail.mockResolvedValue(invitation);
    db.issueInvitationToken.mockResolvedValue({ expiresAt: new Date('2026-10-14T06:00:00Z') });
    const event = {
      id: 'e1',
      tenantId: 't1',
      type: 'com.entlaqa.platform.invitation.created',
      version: 1,
      subject: 'i1',
      data: {},
      actorType: 'user' as const,
      actorId: 'u1',
      actorJob: null,
      correlationId: null,
      createdAt: new Date(),
    };
    const tx = {} as SystemTx;
    await mailer?.handle({ tx, event });
    expect(mail.queueEmail).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        variables: expect.objectContaining({ roleName: { ar: 'متدرب', en: 'Learner' } }) as unknown,
      }),
    );

    db.loadInvitationForMail.mockResolvedValue({ ...invitation, primaryRole: 'nobody' });
    await expect(mailer?.handle({ tx, event })).rejects.toThrow('unknown system role');
  });
});
