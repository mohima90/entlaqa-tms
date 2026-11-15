// @vitest-environment happy-dom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewDelivery, previewDraft, previewProposal } from '../../lib/plan-delivery-preview';
import { deliveryTexts } from '../../lib/plan-delivery-queries';
import { CreateSessionsDialog } from './create-sessions-dialog';
import { DraftSessionDialog } from './draft-session-dialog';
import { LineCourseDialog } from './line-course-dialog';

const actions = vi.hoisted(() => ({
  createCourseFromLineAction: vi.fn(),
  linkLineCourseAction: vi.fn(),
  createDraftSessionsAction: vi.fn(),
  updateDraftSessionAction: vi.fn(),
  deleteDraftSessionAction: vi.fn(),
  moveDraftParticipantAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@jadarat/tms/actions/sessions', () => actions);
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }));

/**
 * The popups of WP-LD-04 (design screens 2, 3 and 5): «A course for …» filled in from the line (create, or link
 * a library course), «Create draft sessions» with its rows and live check, a draft with its changes and its
 * deletion — each sends exactly what the server action takes, and shows a refusal on the row or field it is about.
 */
let root: Root | undefined;
const texts = deliveryTexts('en');
const errors = {
  'errors.validationFailed': 'Some fields need correcting.',
  'errors.internalError': 'Something went wrong.',
};
const CLOSE = '/en/suite/calendar?year=2027';
const EXCEL = '20000000-0000-4000-8000-000000000001';
const CYBER = '20000000-0000-4000-8000-000000000002';
const DRAFT = '90000000-0000-4000-8000-000000000001';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

function mount(ui: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(ui));
  return container;
}
const click = (element: Element | null | undefined) => {
  if (!element) throw new Error('nothing to click');
  act(() => {
    (element as HTMLElement).click();
  });
};
const change = (element: HTMLInputElement | HTMLSelectElement | null, value: string) => {
  if (!element) throw new Error('no field');
  act(() => {
    const proto =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the native setter, so React's value tracking sees a change
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
};
const submit = (id: string) => {
  const form = document.getElementById(id);
  if (!(form instanceof HTMLFormElement)) throw new Error('no form');
  act(() => {
    form.requestSubmit();
  });
};
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
const byTest = (id: string, scope: ParentNode = document) =>
  scope.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allByTest = (id: string, scope: ParentNode = document) => [
  ...scope.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];

const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({
  value: `2027-${String(m).padStart(2, '0')}`,
  label: `Month ${String(m)}`,
}));

function sessionsDialog() {
  const proposal = previewProposal(EXCEL);
  if (!proposal) throw new Error('no proposal');
  // The preview's Excel line is drafted already: here it has no drafts yet.
  const view = { ...proposal, canCreate: true, remaining: 3, problem: null };
  return (
    <CreateSessionsDialog
      locale="en"
      view={view}
      months={months}
      lead="The approved plan: 47 people."
      quarter="Q1"
      fractionDigits={2}
      closeHref={CLOSE}
      preview={false}
      texts={texts}
      errors={errors}
    />
  );
}

describe('«Create draft sessions» (design screen 3)', () => {
  it('proposes one row per session with the plan’s seats, places everyone and matches the plan', () => {
    mount(sessionsDialog());
    const dialog = byTest('create-sessions-dialog');
    expect(dialog?.textContent).toContain(
      'Create 3 draft sessions for «Excel – advanced formulas»',
    );
    const rows = allByTest('create-sessions-row');
    expect(rows).toHaveLength(3);
    expect(
      rows.map((r) => (byTest('create-sessions-month', r) as HTMLSelectElement | null)?.value),
    ).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(byTest('create-sessions-all-placed')?.textContent).toBe('All 47 people have a place');
    expect(byTest('create-sessions-result')?.textContent).toContain(
      'Matches the approved plan: 3 sessions, 47 seats',
    );
    expect(byTest('create-sessions-branches')?.textContent).toContain('Riyadh 27, Jeddah 20');
    expect(byTest('create-sessions-result')?.textContent).toContain('names later');
  });

  it('checks the rows as L&D edits them, and sends the sessions L&D confirmed', async () => {
    actions.createDraftSessionsAction.mockResolvedValue({ ok: true, value: {} });
    mount(sessionsDialog());
    const first = allByTest('create-sessions-row')[0];
    const seats = byTest('create-sessions-seats', first ?? document) as HTMLInputElement | null;
    const named = previewProposal(EXCEL)?.proposal.sessions[0]?.personIds.length ?? 0;
    expect(named).toBeGreaterThan(1);
    change(seats, '1');
    submit('create-sessions-form');
    expect(actions.createDraftSessionsAction).not.toHaveBeenCalled();
    expect(byTest('create-sessions-message')?.textContent).toContain('Check the sessions');
    expect(first?.textContent).toContain('Fewer seats than planned participants.');
    change(seats, String(named + 4));
    // A month outside the line's quarter is allowed, and marked.
    change(byTest('create-sessions-month', first ?? document) as HTMLSelectElement, '2027-05');
    expect(first?.textContent).toContain('Outside the planned quarter');
    click(allByTest('create-sessions-remove')[2]);
    expect(allByTest('create-sessions-row')).toHaveLength(2);
    expect(byTest('create-sessions-dialog')?.textContent).toContain('Create 2 draft sessions');
    expect(byTest('create-sessions-total')?.textContent).toContain('people have no place yet');
    submit('create-sessions-form');
    await flush();
    const proposal = previewProposal(EXCEL)?.proposal.sessions ?? [];
    expect(actions.createDraftSessionsAction).toHaveBeenCalledWith({
      lineId: EXCEL,
      sessions: [
        {
          month: '2027-05',
          branchId: proposal[0]?.branchId,
          seats: named + 4,
          personIds: proposal[0]?.personIds,
        },
        {
          month: '2027-02',
          branchId: proposal[1]?.branchId,
          seats: proposal[1]?.seats,
          personIds: proposal[1]?.personIds,
        },
      ],
    });
    expect(router.replace).toHaveBeenCalledWith(CLOSE, { scroll: false });
  });

  it('shows a refusal of the server on the row it is about', async () => {
    actions.createDraftSessionsAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        messageKey: 'errors.validationFailed',
        fieldErrors: [{ path: 'sessions.1.branchId', code: 'NOT_FOUND' }],
      },
    });
    mount(sessionsDialog());
    submit('create-sessions-form');
    await flush();
    expect(allByTest('create-sessions-row')[1]?.textContent).toContain(
      'This branch no longer exists.',
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('offers no «Create» when the line cannot get drafts, and says why', () => {
    const proposal = previewProposal(EXCEL);
    if (!proposal) throw new Error('no proposal');
    mount(
      <CreateSessionsDialog
        locale="en"
        view={{ ...proposal, canCreate: false, problem: 'SESSION_LINE_ALL_DRAFTED' }}
        months={months}
        lead=""
        quarter="Q1"
        fractionDigits={2}
        closeHref={CLOSE}
        preview={false}
        texts={texts}
        errors={{
          ...errors,
          'errors.sessionLineAllDrafted': 'This line already has its drafts.',
        }}
      />,
    );
    expect(byTest('create-sessions-problem')?.textContent).toBe(
      'This line already has its drafts.',
    );
    expect(byTest('create-sessions-confirm')).toBeNull();
  });
});

function draftDialog() {
  const view = previewDraft(DRAFT);
  if (!view) throw new Error('no draft');
  return (
    <DraftSessionDialog
      locale="en"
      view={view}
      months={months}
      course={{
        title: 'Excel',
        facts: 'CRS-014 · Classroom · 12 hours',
        href: '/en/suite/courses/x',
      }}
      plan={{
        name: 'Training plan 2027',
        facts: 'Excel · Q1',
        href: '/en/suite/planning/cycles/x',
      }}
      cost="SAR 5,000"
      quarter="Q1"
      departments={{}}
      closeHref={CLOSE}
      preview={false}
      texts={texts}
      errors={errors}
    />
  );
}

describe('a draft session (design screen 5)', () => {
  it('saves only what changed, people included', async () => {
    actions.updateDraftSessionAction.mockResolvedValue({ ok: true, value: {} });
    mount(draftDialog());
    const dialog = byTest('draft-session-dialog');
    expect(dialog?.textContent).toContain('Excel · session 1 of 3');
    expect(dialog?.textContent).toContain('Only the L&D team sees it.');
    const people = allByTest('draft-session-person');
    expect(people.length).toBeGreaterThan(1);
    change(byTest('draft-session-seats') as HTMLInputElement, '20');
    change(byTest('draft-session-month') as HTMLSelectElement, '2027-04');
    expect(dialog?.textContent).toContain('Outside the planned quarter');
    click(byTest('draft-session-remove-person', people[0]));
    submit('draft-session-form');
    await flush();
    const view = previewDraft(DRAFT);
    expect(actions.updateDraftSessionAction).toHaveBeenCalledWith({
      sessionId: DRAFT,
      version: 1,
      month: '2027-04',
      seats: 20,
      personIds: view?.participants.slice(1).map((p) => p.personId),
    });
    expect(router.replace).toHaveBeenCalledWith(CLOSE, { scroll: false });
  });

  it('refuses fewer seats than planned participants before sending', () => {
    mount(draftDialog());
    change(byTest('draft-session-seats') as HTMLInputElement, '1');
    submit('draft-session-form');
    expect(actions.updateDraftSessionAction).not.toHaveBeenCalled();
    expect(byTest('draft-session-dialog')?.textContent).toContain(
      'Fewer seats than planned participants.',
    );
  });

  it('adds a person named for the line from another session', async () => {
    actions.updateDraftSessionAction.mockResolvedValue({ ok: true, value: {} });
    mount(draftDialog());
    const before = allByTest('draft-session-person').length;
    click(byTest('draft-session-add'));
    click(allByTest('draft-session-candidate')[0]);
    expect(allByTest('draft-session-person')).toHaveLength(before + 1);
    change(byTest('draft-session-seats') as HTMLInputElement, String(before + 1));
    submit('draft-session-form');
    await flush();
    const call = actions.updateDraftSessionAction.mock.calls[0]?.[0] as { personIds: string[] };
    expect(call.personIds).toHaveLength(before + 1);
  });

  it('moves a planned participant to another session of the line from its ⋯ menu (review L6)', async () => {
    actions.moveDraftParticipantAction.mockResolvedValue({ ok: true, value: {} });
    mount(draftDialog());
    const view = previewDraft(DRAFT);
    const first = view?.participants[0];
    const target = view?.otherSessions.find((o) => o.participants < o.seats);
    if (!first || !target) throw new Error('fixture');
    const person = allByTest('draft-session-person')[0];
    const menu = byTest('draft-session-person-menu', person);
    expect(menu?.getAttribute('aria-expanded')).toBe('false');
    click(menu);
    expect(menu?.getAttribute('aria-expanded')).toBe('true');
    expect(byTest('draft-session-move-person', person)?.textContent).toContain(
      'Move to another session',
    );
    expect(byTest('draft-session-remove-person', person)?.textContent).toContain(
      'Remove from this session',
    );
    click(byTest('draft-session-move-person', person));
    const dialog = byTest('draft-session-move-dialog');
    expect(dialog?.textContent).toContain(`Session ${String(target.ordinal)} ·`);
    expect(allByTest('draft-session-move-option')).toHaveLength(view.otherSessions.length);
    click(byTest('draft-session-move-confirm'));
    await flush();
    expect(actions.moveDraftParticipantAction).toHaveBeenCalledWith({
      sessionId: DRAFT,
      version: 1,
      personId: first.personId,
      toSessionId: target.id,
    });
    expect(router.refresh).toHaveBeenCalled();
    expect(actions.updateDraftSessionAction).not.toHaveBeenCalled();
  });

  it('asks to save first before a move, and removes a person from the menu', () => {
    mount(draftDialog());
    const before = allByTest('draft-session-person').length;
    change(byTest('draft-session-seats') as HTMLInputElement, '40');
    const person = allByTest('draft-session-person')[0];
    click(byTest('draft-session-person-menu', person));
    const move = byTest('draft-session-move-person', person) as HTMLButtonElement | null;
    expect(move?.disabled).toBe(true);
    expect(move?.textContent).toContain('Save your changes first');
    click(byTest('draft-session-remove-person', person));
    expect(allByTest('draft-session-person')).toHaveLength(before - 1);
    expect(actions.moveDraftParticipantAction).not.toHaveBeenCalled();
  });

  it('deletes the draft after a confirmation', async () => {
    actions.deleteDraftSessionAction.mockResolvedValue({ ok: true, value: {} });
    mount(draftDialog());
    click(byTest('draft-session-delete'));
    expect(byTest('draft-session-delete-dialog')?.textContent).toContain(
      'Delete this draft session?',
    );
    expect(actions.deleteDraftSessionAction).not.toHaveBeenCalled();
    click(byTest('draft-session-delete-confirm'));
    await flush();
    expect(actions.deleteDraftSessionAction).toHaveBeenCalledWith({ sessionId: DRAFT, version: 1 });
    expect(router.replace).toHaveBeenCalledWith(CLOSE, { scroll: false });
  });
});

function courseDialog(mode: 'create' | 'link' = 'create') {
  const line = previewDelivery().delivery.lines.find((l) => l.lineId === CYBER);
  if (!line) throw new Error('no line');
  return (
    <LineCourseDialog
      locale="en"
      line={{ id: line.lineId, version: line.version, title: line.title, facts: 'Q1 · 65 people' }}
      draft={line.courseDraft}
      mode={mode}
      canCreate
      canLink
      nameLanguage="en"
      deliveryTypes={[
        { value: 'classroom', label: 'Classroom' },
        { value: 'virtual', label: 'Virtual' },
      ]}
      categories={[]}
      courses={[
        {
          id: '30000000-0000-4000-8000-000000000003',
          code: 'CRS-002',
          title: 'Information security basics',
          deliveryType: 'virtual',
          durationHours: 3,
        },
      ]}
      truncated={false}
      currentCourseId={null}
      costsVisible
      currency="SAR"
      closeHref={CLOSE}
      nextHref="/en/next"
      preview={false}
      texts={texts}
      errors={errors}
    />
  );
}

describe('«A course for …» (design screen 2)', () => {
  it('is filled in from the line, asks what is missing, and creates the course for the line', async () => {
    actions.createCourseFromLineAction.mockResolvedValue({ ok: true, value: {} });
    mount(courseDialog());
    const title = byTest('line-course-titleEn') as HTMLInputElement | null;
    expect(title?.value).toBe('Cyber security awareness');
    expect(byTest('line-course-dialog')?.textContent).toContain('From the plan');
    submit('line-course-form');
    expect(actions.createCourseFromLineAction).not.toHaveBeenCalled();
    expect(byTest('line-course-message')?.textContent).toBe('Some fields need correcting.');
    change(byTest('line-course-durationHours') as HTMLInputElement, '3');
    // «Save and next line» goes on to the next line without a course.
    click(byTest('line-course-save-next'));
    await flush();
    expect(actions.createCourseFromLineAction).toHaveBeenCalledWith({
      lineId: CYBER,
      lineVersion: 1,
      course: expect.objectContaining({
        code: null,
        titleEn: 'Cyber security awareness',
        titleAr: '',
        deliveryType: 'virtual',
        durationHours: 3,
        minParticipants: 10,
        maxParticipants: 55,
        estCostPerSession: 2500,
        category: { kind: 'none' },
      }),
    });
    expect(router.replace).toHaveBeenCalledWith('/en/next', { scroll: false });
  });

  it('links a course of the library instead', async () => {
    actions.linkLineCourseAction.mockResolvedValue({ ok: true, value: {} });
    mount(courseDialog());
    click(byTest('line-course-mode-link'));
    submit('line-course-form');
    expect(byTest('line-course-message')?.textContent).toBe('Choose a course first.');
    click(document.querySelector('#line-course-option-30000000-0000-4000-8000-000000000003'));
    submit('line-course-form');
    await flush();
    expect(actions.linkLineCourseAction).toHaveBeenCalledWith({
      lineId: CYBER,
      lineVersion: 1,
      courseId: '30000000-0000-4000-8000-000000000003',
    });
    expect(router.replace).toHaveBeenCalledWith(CLOSE, { scroll: false });
  });

  it('shows a refusal of the server on its field', async () => {
    actions.createCourseFromLineAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        messageKey: 'errors.validationFailed',
        fieldErrors: [{ path: 'course.code', code: 'CODE_TAKEN' }],
      },
    });
    mount(courseDialog());
    change(byTest('line-course-durationHours') as HTMLInputElement, '3');
    change(byTest('line-course-code') as HTMLInputElement, 'CRS-001');
    submit('line-course-form');
    await flush();
    expect(byTest('line-course-dialog')?.textContent).toContain(
      'Another course already uses this code.',
    );
    expect(router.replace).not.toHaveBeenCalled();
  });
});
