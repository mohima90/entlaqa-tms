import type {
  InlineEmailTestTicket,
  InlineInvitationFacts,
  InlineMailTicket,
} from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import {
  type InlineEmailTesterDeps,
  type InlineMailerDeps,
  createInlineEmailTester,
  createInlineInvitationMailer,
  inlineMailBase,
  inlineMailConfigured,
} from './inline-mail';

const ID = '6a1f3c2e-4b5d-4e6f-8a7b-9c0d1e2f3a4b';
const KEY = 'k'.repeat(40);

const facts: InlineInvitationFacts = {
  invitationId: ID,
  sendCount: 1,
  email: 'noura.alqahtani@raya.example',
  locale: 'en',
  personId: '7b2e4d3f-5c6e-4f70-9b8c-0d1e2f3a4b5c',
  code: 'K7M2PQ9XHT4W',
  recipientName: { ar: 'نورة', en: 'Noura' },
  inviterName: { ar: 'محمد', en: 'Mohammed' },
  organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
  primaryRole: 'learner',
  primaryRoleName: null,
  expiresAt: new Date('2026-10-14T06:00:00.000Z'),
  sourceKey: `invitation:${ID}:1`,
  brand: { actionColor: '#112233', linkColor: '#445566', logoAssetId: null },
};
const ticket: InlineMailTicket = { id: 'd1', secret: Buffer.alloc(32, 1) };
const role = () => ({ ar: 'متعلم', en: 'Learner' });

function setup(over: Partial<InlineMailerDeps> = {}) {
  const queue = vi.fn((_tx: unknown, _mail: unknown) =>
    Promise.resolve<InlineMailTicket | null>(ticket),
  );
  const prepare = vi.fn((_tx: unknown, _id: string) =>
    Promise.resolve<InlineInvitationFacts | null>(facts),
  );
  const schedule = vi.fn((work: () => Promise<unknown>) => {
    void work();
  });
  const send = vi.fn((_ticket: InlineMailTicket) => Promise.resolve('sent'));
  const warn = vi.fn();
  const savepoints: unknown[] = [];
  const tx = {
    transaction: <T>(fn: (sp: unknown) => Promise<T>) => {
      const sp = { savepoint: savepoints.length + 1 };
      savepoints.push(sp);
      return fn(sp);
    },
  };
  const deps: InlineMailerDeps = {
    configured: () => true,
    base: () => 'https://tms.example.com',
    prepare: prepare,
    queue: queue,
    schedule,
    send,
    warn,
    ...over,
  };
  return {
    mailer: createInlineInvitationMailer(deps),
    tx: tx as never,
    queue,
    prepare,
    schedule,
    send,
    warn,
    savepoints,
  };
}

describe('the invitation e-mail, queued in the action and sent once it has committed', () => {
  it("prepares, renders and queues in a savepoint of the action's transaction, then schedules the send", async () => {
    const { mailer, tx, queue, prepare, schedule, send, savepoints } = setup();
    await mailer(tx, ID, role);
    expect(savepoints).toHaveLength(1);
    expect(prepare).toHaveBeenCalledWith(savepoints[0], ID);
    const queued = (queue.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(queued).toMatchObject({
      kind: 'invitation',
      ref: ID,
      template: 'platform.invitation',
      locale: 'en',
      to: 'noura.alqahtani@raya.example',
      sourceKey: `invitation:${ID}:1`,
    });
    // The very e-mail the worker's mailer would send: the sign-up link with the code in the fragment.
    expect(queued.text).toContain('https://tms.example.com/en/sign-up#code=K7M2PQ9XHT4W');
    expect(queued.html).toContain('Al Raya');
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(ticket);
  });

  it('nothing is queued where the web app cannot send, has no usable origin, or the member may not manage the invitation', async () => {
    for (const over of [
      { configured: () => false },
      { base: () => undefined },
      { prepare: () => Promise.resolve(null) },
    ] as Partial<InlineMailerDeps>[]) {
      const { mailer, tx, queue, schedule } = setup(over);
      await mailer(tx, ID, role);
      expect(queue).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
    }
  });

  it("the same message queued already (the worker's mailer, an earlier request): nothing to send from here", async () => {
    const { mailer, tx, schedule } = setup({ queue: () => Promise.resolve(null) });
    await mailer(tx, ID, role);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("a failure never reaches the action: it is logged without personal data and the worker's mailer sends it", async () => {
    const { mailer, tx, schedule, warn } = setup({
      prepare: () =>
        Promise.reject(new Error('relation does not exist: noura.alqahtani@raya.example')),
    });
    await expect(mailer(tx, ID, role)).resolves.toBeUndefined();
    expect(schedule).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('worker will send'), {
      reason: 'Error',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('noura');
  });

  it('names a custom role as the organization wrote it', async () => {
    const { mailer, tx, queue } = setup({
      prepare: () =>
        Promise.resolve({
          ...facts,
          primaryRoleName: { ar: 'منسق فرع', en: 'Branch coordinator' },
        }),
    });
    await mailer(tx, ID, role);
    const queued = (queue.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(queued.text).toContain('Branch coordinator');
  });
});

describe('where the web app sends from', () => {
  it('needs the key that opens saved provider secrets, or an installation sender', () => {
    expect(inlineMailConfigured({})).toBe(false);
    expect(inlineMailConfigured({ EMAIL_CREDENTIALS_KEY: 'short' })).toBe(false);
    expect(inlineMailConfigured({ EMAIL_CREDENTIALS_KEY: KEY })).toBe(true);
    expect(inlineMailConfigured({ EMAIL_PROVIDER: 'smtp' })).toBe(true);
    expect(inlineMailConfigured({ EMAIL_PROVIDER: 'none' })).toBe(false);
  });

  it("links on the app's public https origin, without a trailing slash", () => {
    expect(inlineMailBase({ APP_BASE_URL: 'https://tms.example.com//' })).toBe(
      'https://tms.example.com',
    );
    expect(inlineMailBase({ APP_BASE_URL: 'http://localhost:3200' })).toBe('http://localhost:3200');
    expect(inlineMailBase({ APP_BASE_URL: 'http://tms.example.com' })).toBeUndefined();
    expect(inlineMailBase({})).toBeUndefined();
  });
});

describe('the test e-mail of the settings pages, claimed in the action and sent once it has committed', () => {
  const testTicket = { secret: Buffer.alloc(32, 2), test: {} } as unknown as InlineEmailTestTicket;
  function tester(over: Partial<InlineEmailTesterDeps> = {}) {
    const claim = vi.fn((_tx: unknown, _scope: string) =>
      Promise.resolve<InlineEmailTestTicket | null>(testTicket),
    );
    const schedule = vi.fn((work: () => Promise<unknown>) => {
      void work();
    });
    const send = vi.fn((_ticket: InlineEmailTestTicket) => Promise.resolve('sent'));
    const warn = vi.fn();
    const tx = {
      transaction: <T>(fn: (sp: unknown) => Promise<T>) => fn({ savepoint: true }),
    } as never;
    const start = createInlineEmailTester({
      configured: () => true,
      claim: claim,
      schedule,
      send,
      warn,
      ...over,
    });
    return { start, tx, claim, schedule, send, warn };
  }

  it("claims in a savepoint of the action's transaction, then schedules the send", async () => {
    const { start, tx, claim, schedule, send } = tester();
    await start(tx, 'tenant');
    expect(claim).toHaveBeenCalledWith({ savepoint: true }, 'tenant');
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(testTicket);
  });

  it('nothing is claimed where the web app cannot open the saved secrets; nothing is scheduled without a ticket', async () => {
    const off = tester({ configured: () => false });
    await off.start(off.tx, 'platform');
    expect(off.claim).not.toHaveBeenCalled();
    const none = tester({ claim: () => Promise.resolve(null) });
    await none.start(none.tx, 'platform');
    expect(none.schedule).not.toHaveBeenCalled();
  });

  it('a failure never reaches the action; the worker sends the test', async () => {
    const { start, tx, schedule, warn } = tester({ claim: () => Promise.reject(new Error('db')) });
    await expect(start(tx, 'tenant')).resolves.toBeUndefined();
    expect(schedule).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('worker will send'), {
      reason: 'Error',
    });
  });
});
