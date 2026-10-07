import { createHash } from 'node:crypto';
import type { InvitationForMail, SystemTx } from '@jadarat/platform-db/jobs';
import type { DeliveredEvent } from '@jadarat/platform-jobs/jobs';
import { InvitationVariables } from '@jadarat/platform-notifications';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVITATION_CREATED_EVENT,
  INVITATION_MAILER_NAME,
  INVITATION_RESEND_REQUESTED_EVENT,
  createInvitationMailer,
  hashToken,
} from './index';

const db = vi.hoisted(() => ({
  loadInvitationForMail: vi.fn(),
  issueInvitationToken: vi.fn(),
  invitationActorMayManage: vi.fn(),
}));
const mail = vi.hoisted(() => ({ queueEmail: vi.fn() }));
vi.mock('@jadarat/platform-db/jobs', () => db);
vi.mock('@jadarat/platform-notifications/jobs', () => mail);

const ID = '6a1f3c2e-4b5d-4e6f-8a7b-9c0d1e2f3a4b';
const PERSON = '7b2e4d3f-5c6e-4f70-9b8c-0d1e2f3a4b5c';
const EXPIRES = new Date('2026-10-14T06:00:00.000Z');
const tx = {} as SystemTx;

const invitation: InvitationForMail = {
  id: ID,
  status: 'pending',
  sendCount: 0,
  email: 'noura.alqahtani@raya.example',
  locale: 'ar',
  personId: PERSON,
  recipientName: { ar: 'نورة القحطاني', en: 'Noura Alqahtani' },
  inviterName: { ar: 'محمد العتيبي', en: null },
  organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
  primaryRole: 'learner',
};

const event = (
  type = INVITATION_CREATED_EVENT,
  subject: string | null = ID,
  actor: Pick<DeliveredEvent, 'actorType' | 'actorId'> = { actorType: 'user', actorId: 'u1' },
): DeliveredEvent => ({
  id: 'e1',
  tenantId: 't1',
  type,
  version: 1,
  subject,
  data: {},
  ...actor,
  actorJob: null,
  correlationId: null,
  createdAt: new Date(),
});

const roleName = vi.fn((code: string) =>
  code === 'learner' ? { ar: 'متدرب', en: 'Learner' } : { ar: 'دور', en: 'Role' },
);

function mailer(appBaseUrl = 'https://tms.example.com', log = vi.fn()) {
  return { log, subscriber: createInvitationMailer({ appBaseUrl, roleName, log }) };
}

interface Queued {
  template: string;
  locale: string;
  to: string;
  recipientPersonId: string;
  sourceEventId: string;
  variables: InvitationVariables;
}

const queued = (call = 0): Queued => mail.queueEmail.mock.calls[call]?.[1] as Queued;

beforeEach(() => {
  db.invitationActorMayManage.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('invitation mailer', () => {
  it('is a transactional subscriber of invitation created / resend requested', () => {
    const { subscriber } = mailer();
    expect(subscriber).toMatchObject({
      name: INVITATION_MAILER_NAME,
      types: [INVITATION_CREATED_EVENT, INVITATION_RESEND_REQUESTED_EVENT],
      maxAttempts: 10,
    });
    expect(subscriber.kind).toBeUndefined();
  });

  it('issues a token, stores only its hash and queues the invitation e-mail with the accept link', async () => {
    db.loadInvitationForMail.mockResolvedValue(invitation);
    db.issueInvitationToken.mockResolvedValue({ expiresAt: EXPIRES });
    const { subscriber, log } = mailer();
    await subscriber.handle({ tx, event: event() });

    expect(db.loadInvitationForMail).toHaveBeenCalledWith(tx, ID);
    expect(mail.queueEmail).toHaveBeenCalledTimes(1);
    expect(mail.queueEmail.mock.calls[0]?.[0]).toBe(tx);
    const request = queued();
    expect(request).toMatchObject({
      template: 'platform.invitation',
      locale: 'ar',
      to: 'noura.alqahtani@raya.example',
      recipientPersonId: PERSON,
      sourceEventId: 'e1',
    });
    const match =
      /^https:\/\/tms\.example\.com\/ar\/invite\/accept#token=([A-Za-z0-9_-]{43})$/.exec(
        request.variables.acceptUrl,
      );
    const token = match?.[1] ?? '';
    expect(token).not.toBe('');
    // 32 random bytes; the database receives only their SHA-256 (of the token's UTF-8 text).
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    const [, issuedFor, hash] = db.issueInvitationToken.mock.calls[0] as [SystemTx, string, Buffer];
    expect(issuedFor).toBe(ID);
    expect(hash.equals(createHash('sha256').update(token, 'utf8').digest())).toBe(true);
    expect(hash.equals(hashToken(token))).toBe(true);
    expect(request.variables).toEqual({
      recipientName: { ar: 'نورة القحطاني', en: 'Noura Alqahtani' },
      inviterName: { ar: 'محمد العتيبي', en: null },
      organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
      roleName: { ar: 'متدرب', en: 'Learner' },
      acceptUrl: request.variables.acceptUrl,
      expiresAt: '2026-10-14T06:00:00.000Z',
      timeZone: 'Asia/Riyadh',
      loginEmail: 'noura.alqahtani@raya.example',
    });
    expect(roleName).toHaveBeenCalledWith('learner');
    // What the template accepts (rendering validates the same schema).
    expect(InvitationVariables.safeParse(request.variables).success).toBe(true);
    expect(log).toHaveBeenCalledWith('info', 'invitation e-mail queued');
  });

  it('each send gets a new token; the English invitation links to the English page', async () => {
    db.loadInvitationForMail.mockResolvedValue({ ...invitation, locale: 'en', sendCount: 3 });
    db.issueInvitationToken.mockResolvedValue({ expiresAt: EXPIRES });
    const { subscriber } = mailer('http://localhost:3200/');
    await subscriber.handle({ tx, event: event(INVITATION_RESEND_REQUESTED_EVENT) });
    await subscriber.handle({ tx, event: event(INVITATION_RESEND_REQUESTED_EVENT) });
    const [first, second] = [queued(0), queued(1)];
    expect(first.locale).toBe('en');
    expect(first.variables.acceptUrl).toMatch(
      /^http:\/\/localhost:3200\/en\/invite\/accept#token=[A-Za-z0-9_-]{43}$/,
    );
    expect(second.variables.acceptUrl).not.toBe(first.variables.acceptUrl);
    const hashes = db.issueInvitationToken.mock.calls.map((c) => (c[2] as Buffer).toString('hex'));
    expect(new Set(hashes).size).toBe(2);
  });

  it('skips quietly: no subject, unknown, no longer pending, send limit reached, or refused by the database', async () => {
    const { subscriber, log } = mailer();
    await subscriber.handle({ tx, event: event(INVITATION_CREATED_EVENT, null) });
    expect(db.loadInvitationForMail).not.toHaveBeenCalled();

    for (const loaded of [
      null,
      { ...invitation, status: 'revoked' },
      { ...invitation, status: 'accepted' },
      { ...invitation, sendCount: 4 },
    ]) {
      db.loadInvitationForMail.mockResolvedValueOnce(loaded);
      await subscriber.handle({ tx, event: event() });
    }
    expect(db.issueInvitationToken).not.toHaveBeenCalled();

    db.loadInvitationForMail.mockResolvedValueOnce(invitation);
    db.issueInvitationToken.mockResolvedValueOnce(null);
    await subscriber.handle({ tx, event: event() });
    expect(db.issueInvitationToken).toHaveBeenCalledTimes(1);
    expect(mail.queueEmail).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warning', 'invitation event without subject; ignored');
    expect(log).toHaveBeenCalledWith(
      'info',
      'invitation not pending or send limit reached; no e-mail',
    );
  });

  it("acts only on a member's event while that member may still manage the invitation", async () => {
    db.loadInvitationForMail.mockResolvedValue(invitation);
    db.issueInvitationToken.mockResolvedValue({ expiresAt: EXPIRES });
    const { subscriber, log } = mailer();
    // Not from a member: a system job, a platform operation, or no actor id.
    for (const actor of [
      { actorType: 'system', actorId: null },
      { actorType: 'platform', actorId: null },
      { actorType: 'user', actorId: null },
    ] as const) {
      await subscriber.handle({ tx, event: event(INVITATION_RESEND_REQUESTED_EVENT, ID, actor) });
    }
    expect(db.invitationActorMayManage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warning', 'invitation event not from a member; ignored');

    // The member was revoked, suspended or demoted since (created and resend alike).
    db.invitationActorMayManage.mockResolvedValue(false);
    await subscriber.handle({ tx, event: event(INVITATION_RESEND_REQUESTED_EVENT) });
    await subscriber.handle({ tx, event: event(INVITATION_CREATED_EVENT) });
    expect(db.invitationActorMayManage).toHaveBeenCalledWith(tx, ID, 'u1');
    expect(log).toHaveBeenCalledWith(
      'warning',
      'invitation event from a member who may no longer manage it; no e-mail',
    );
    expect(db.loadInvitationForMail).not.toHaveBeenCalled();
    expect(db.issueInvitationToken).not.toHaveBeenCalled();
    expect(mail.queueEmail).not.toHaveBeenCalled();
  });

  it('a failure propagates (the job retries; the transaction rolls back)', async () => {
    db.loadInvitationForMail.mockResolvedValue(invitation);
    db.issueInvitationToken.mockResolvedValue({ expiresAt: EXPIRES });
    mail.queueEmail.mockRejectedValueOnce(new Error('database unavailable'));
    const { subscriber } = mailer();
    await expect(subscriber.handle({ tx, event: event() })).rejects.toThrow('database unavailable');
  });

  it('never logs names, addresses or tokens', async () => {
    db.loadInvitationForMail.mockResolvedValue(invitation);
    db.issueInvitationToken.mockResolvedValue({ expiresAt: EXPIRES });
    const { subscriber, log } = mailer();
    await subscriber.handle({ tx, event: event() });
    db.issueInvitationToken.mockResolvedValue(null);
    await subscriber.handle({ tx, event: event() });
    const token = /token=(.+)$/.exec(queued().variables.acceptUrl)?.[1] ?? '';
    const logged = JSON.stringify(log.mock.calls);
    for (const secret of [
      token,
      'noura',
      'raya.example',
      'نورة',
      'Noura',
      'محمد',
      'الراية',
      'Al Raya',
      ID,
      PERSON,
    ]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('refuses an app base URL that is not https (http only for localhost)', () => {
    for (const bad of ['http://tms.example.com', 'tms.example.com', 'javascript:alert(1)']) {
      expect(() => mailer(bad)).toThrow('app base URL');
    }
    expect(() => mailer('http://127.0.0.1:3200')).not.toThrow();
  });
});
