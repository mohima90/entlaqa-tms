import type { InvitationForMail, SystemTx } from '@jadarat/platform-db/jobs';
import type { DeliveredEvent } from '@jadarat/platform-jobs/jobs';
import { InvitationVariables } from '@jadarat/platform-notifications';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVITATION_CREATED_EVENT,
  INVITATION_MAILER_NAME,
  INVITATION_RELEASED_EVENT,
  INVITATION_RESEND_REQUESTED_EVENT,
  createInvitationMailer,
} from './index';

const db = vi.hoisted(() => ({
  loadInvitationForMail: vi.fn(),
  invitationCodeForMail: vi.fn(),
  invitationActorMayManage: vi.fn(),
  noteInvitationMailSkipped: vi.fn(),
  inlineDeliveryExists: vi.fn(),
}));
const mail = vi.hoisted(() => ({ queueEmail: vi.fn() }));
vi.mock('@jadarat/platform-db/jobs', () => db);
vi.mock('@jadarat/platform-notifications/jobs', () => mail);

const ID = '6a1f3c2e-4b5d-4e6f-8a7b-9c0d1e2f3a4b';
const PERSON = '7b2e4d3f-5c6e-4f70-9b8c-0d1e2f3a4b5c';
const EXPIRES = new Date('2026-10-14T06:00:00.000Z');
const tx = {} as SystemTx;
const CODE = 'K7M2PQ9XHT4W';

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
  primaryRoleName: null,
  invitedBy: 'u1',
  sendRequestedBy: null,
  mailHeld: false,
  expiresAt: EXPIRES,
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
  db.inlineDeliveryExists.mockResolvedValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('invitation mailer', () => {
  it("adds nothing when the web app already queued this code's e-mail (immediate sending)", async () => {
    db.loadInvitationForMail.mockResolvedValue({ ...invitation, sendCount: 2 });
    db.invitationCodeForMail.mockResolvedValue(CODE);
    db.inlineDeliveryExists.mockResolvedValue(true);
    const { subscriber } = mailer();
    await subscriber.handle({ tx, event: event() });
    expect(db.inlineDeliveryExists).toHaveBeenCalledWith(tx, `invitation:${ID}:2`);
    expect(mail.queueEmail).not.toHaveBeenCalled();
  });

  it('is a transactional subscriber of invitation created / resend requested / released', () => {
    const { subscriber } = mailer();
    expect(subscriber).toMatchObject({
      name: INVITATION_MAILER_NAME,
      types: [
        INVITATION_CREATED_EVENT,
        INVITATION_RESEND_REQUESTED_EVENT,
        INVITATION_RELEASED_EVENT,
      ],
      maxAttempts: 10,
    });
    expect(subscriber.kind).toBeUndefined();
  });

  it('e-mails the code the database issued: the sign-up link with the code in the fragment', async () => {
    db.loadInvitationForMail.mockResolvedValue(invitation);
    db.invitationCodeForMail.mockResolvedValue(CODE);
    const { subscriber, log } = mailer();
    await subscriber.handle({ tx, event: event() });

    expect(db.loadInvitationForMail).toHaveBeenCalledWith(tx, ID);
    expect(db.invitationCodeForMail).toHaveBeenCalledWith(tx, ID);
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
    expect(request.variables).toEqual({
      recipientName: { ar: 'نورة القحطاني', en: 'Noura Alqahtani' },
      inviterName: { ar: 'محمد العتيبي', en: null },
      organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
      roleName: { ar: 'متدرب', en: 'Learner' },
      acceptUrl: `https://tms.example.com/ar/sign-up#code=${CODE}`,
      // The code's expiry, as the database set it when issuing the code.
      expiresAt: '2026-10-14T06:00:00.000Z',
      timeZone: 'Asia/Riyadh',
      loginEmail: 'noura.alqahtani@raya.example',
    });
    expect(roleName).toHaveBeenCalledWith('learner');
    // What the template accepts (rendering validates the same schema).
    expect(InvitationVariables.safeParse(request.variables).success).toBe(true);
    expect(log).toHaveBeenCalledWith('info', 'invitation e-mail queued');
  });

  it('names a custom role as the organization wrote it (EP-ROLES)', async () => {
    db.loadInvitationForMail.mockResolvedValue({
      ...invitation,
      primaryRole: 'custom_0123456789ab',
      primaryRoleName: { ar: 'مراجع الدورات', en: 'Course reviewer' },
    });
    db.invitationCodeForMail.mockResolvedValue(CODE);
    roleName.mockClear();
    const { subscriber } = mailer();
    await subscriber.handle({ tx, event: event() });
    expect(queued().variables).toMatchObject({
      roleName: { ar: 'مراجع الدورات', en: 'Course reviewer' },
    });
    expect(roleName).not.toHaveBeenCalled();
  });

  it('a resend e-mails the current (new) code; the English invitation links to the English page', async () => {
    db.loadInvitationForMail.mockResolvedValue({ ...invitation, locale: 'en', sendCount: 4 });
    db.invitationCodeForMail.mockResolvedValueOnce(CODE).mockResolvedValueOnce('NEWCQDE2HT4W');
    const { subscriber } = mailer('http://localhost:3200/');
    await subscriber.handle({ tx, event: event(INVITATION_RESEND_REQUESTED_EVENT) });
    await subscriber.handle({ tx, event: event(INVITATION_RESEND_REQUESTED_EVENT) });
    const [first, second] = [queued(0), queued(1)];
    expect(first.locale).toBe('en');
    expect(first.variables.acceptUrl).toBe(`http://localhost:3200/en/sign-up#code=${CODE}`);
    // The 4th code (send count 4) is still e-mailed: the database counted it, the mailer does not.
    expect(second.variables.acceptUrl).toBe('http://localhost:3200/en/sign-up#code=NEWCQDE2HT4W');
  });

  it('skips quietly: no subject, unknown, no longer pending, or without a code', async () => {
    const { subscriber, log } = mailer();
    await subscriber.handle({ tx, event: event(INVITATION_CREATED_EVENT, null) });
    expect(db.loadInvitationForMail).not.toHaveBeenCalled();

    for (const loaded of [
      null,
      { ...invitation, status: 'revoked' },
      { ...invitation, status: 'accepted' },
    ]) {
      db.loadInvitationForMail.mockResolvedValueOnce(loaded);
      await subscriber.handle({ tx, event: event() });
    }
    expect(db.invitationCodeForMail).not.toHaveBeenCalled();

    // A link e-mailed before codes (no code): nothing to e-mail.
    db.loadInvitationForMail.mockResolvedValueOnce(invitation);
    db.invitationCodeForMail.mockResolvedValueOnce(null);
    await subscriber.handle({ tx, event: event() });
    expect(db.invitationCodeForMail).toHaveBeenCalledTimes(1);
    expect(mail.queueEmail).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warning', 'invitation event without subject; ignored');
    expect(log).toHaveBeenCalledWith('info', 'invitation not pending; no e-mail');
    expect(log).toHaveBeenCalledWith('info', 'invitation has no code; no e-mail');
  });

  it("acts only on a member's event while that member may still manage the invitation", async () => {
    db.loadInvitationForMail.mockResolvedValue(invitation);
    db.invitationCodeForMail.mockResolvedValue(CODE);
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
    // T-M2-20: the users list shows the code as not e-mailed.
    expect(db.noteInvitationMailSkipped).toHaveBeenCalledWith(tx, ID);
    expect(db.loadInvitationForMail).not.toHaveBeenCalled();
    expect(db.invitationCodeForMail).not.toHaveBeenCalled();
    expect(mail.queueEmail).not.toHaveBeenCalled();
  });

  it('a failure propagates (the job retries; the transaction rolls back)', async () => {
    db.loadInvitationForMail.mockResolvedValue(invitation);
    db.invitationCodeForMail.mockResolvedValue(CODE);
    mail.queueEmail.mockRejectedValueOnce(new Error('database unavailable'));
    const { subscriber } = mailer();
    await expect(subscriber.handle({ tx, event: event() })).rejects.toThrow('database unavailable');
  });

  it('never logs names, addresses or codes', async () => {
    db.loadInvitationForMail.mockResolvedValue(invitation);
    db.invitationCodeForMail.mockResolvedValue(CODE);
    const { subscriber, log } = mailer();
    await subscriber.handle({ tx, event: event() });
    db.invitationCodeForMail.mockResolvedValue(null);
    await subscriber.handle({ tx, event: event() });
    const token = /code=(.+)$/.exec(queued().variables.acceptUrl)?.[1] ?? '';
    expect(token).toBe(CODE);
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

  describe('released invitations of a user import (T-M2-12)', () => {
    const system = { actorType: 'system', actorId: null } as const;

    it('mails a released invitation as the importer, while the importer may still manage it', async () => {
      db.loadInvitationForMail.mockResolvedValue({ ...invitation, invitedBy: 'importer-1' });
      db.invitationCodeForMail.mockResolvedValue(CODE);
      const { subscriber } = mailer();
      await subscriber.handle({ tx, event: event(INVITATION_RELEASED_EVENT, ID, system) });
      expect(db.invitationActorMayManage).toHaveBeenCalledWith(tx, ID, 'importer-1');
      expect(db.loadInvitationForMail).toHaveBeenCalledTimes(1);
      expect(mail.queueEmail).toHaveBeenCalledTimes(1);
      expect(queued().variables.inviterName).toEqual({ ar: 'محمد العتيبي', en: null });
    });

    it('mails a release that a member asked for as theirs, while they may still manage it (integration review M2)', async () => {
      // The importer left or was demoted; an Organization Admin asked to send it from the users list.
      db.loadInvitationForMail.mockResolvedValue({
        ...invitation,
        invitedBy: 'importer-1',
        sendRequestedBy: 'admin-1',
      });
      db.invitationActorMayManage.mockImplementation((_tx: unknown, _id: string, actor: string) =>
        Promise.resolve(actor === 'admin-1'),
      );
      db.invitationCodeForMail.mockResolvedValue(CODE);
      const { subscriber } = mailer();
      await subscriber.handle({ tx, event: event(INVITATION_RELEASED_EVENT, ID, system) });
      expect(db.invitationActorMayManage).toHaveBeenCalledTimes(1);
      expect(db.invitationActorMayManage).toHaveBeenCalledWith(tx, ID, 'admin-1');
      expect(mail.queueEmail).toHaveBeenCalledTimes(1);
    });

    it('sends nothing when the member who asked may no longer manage it, even if the importer may', async () => {
      db.loadInvitationForMail.mockResolvedValue({
        ...invitation,
        invitedBy: 'importer-1',
        sendRequestedBy: 'admin-1',
      });
      db.invitationActorMayManage.mockImplementation((_tx: unknown, _id: string, actor: string) =>
        Promise.resolve(actor === 'importer-1'),
      );
      const { subscriber, log } = mailer();
      await subscriber.handle({ tx, event: event(INVITATION_RELEASED_EVENT, ID, system) });
      expect(db.invitationActorMayManage).toHaveBeenCalledWith(tx, ID, 'admin-1');
      expect(db.invitationActorMayManage).not.toHaveBeenCalledWith(tx, ID, 'importer-1');
      expect(log).toHaveBeenCalledWith(
        'warning',
        'invitation event from a member who may no longer manage it; no e-mail',
      );
      expect(db.invitationCodeForMail).not.toHaveBeenCalled();
      expect(mail.queueEmail).not.toHaveBeenCalled();
    });

    it('ignores a release that a member sent, or one for an importer who may no longer invite', async () => {
      db.loadInvitationForMail.mockResolvedValue(invitation);
      const { subscriber, log } = mailer();
      await subscriber.handle({ tx, event: event(INVITATION_RELEASED_EVENT) });
      expect(log).toHaveBeenCalledWith(
        'warning',
        'invitation release not from the import task; ignored',
      );
      db.invitationActorMayManage.mockResolvedValue(false);
      await subscriber.handle({ tx, event: event(INVITATION_RELEASED_EVENT, ID, system) });
      expect(log).toHaveBeenCalledWith(
        'warning',
        'invitation event from a member who may no longer manage it; no e-mail',
      );
      db.loadInvitationForMail.mockResolvedValue({ ...invitation, invitedBy: null });
      db.invitationActorMayManage.mockResolvedValue(true);
      await subscriber.handle({ tx, event: event(INVITATION_RELEASED_EVENT, ID, system) });
      expect(db.invitationCodeForMail).not.toHaveBeenCalled();
      expect(mail.queueEmail).not.toHaveBeenCalled();
    });

    it('never mails an invitation that is still held', async () => {
      db.loadInvitationForMail.mockResolvedValue({ ...invitation, mailHeld: true });
      const { subscriber, log } = mailer();
      await subscriber.handle({ tx, event: event(INVITATION_RELEASED_EVENT, ID, system) });
      await subscriber.handle({ tx, event: event(INVITATION_RESEND_REQUESTED_EVENT) });
      expect(log).toHaveBeenCalledWith('info', 'invitation not sent yet (held); no e-mail');
      expect(db.invitationCodeForMail).not.toHaveBeenCalled();
      expect(mail.queueEmail).not.toHaveBeenCalled();
    });
  });
});
