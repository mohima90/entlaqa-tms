// @vitest-environment happy-dom
import en from '@jadarat/platform-i18n/messages/en.json';
import ar from '@jadarat/platform-i18n/messages/ar.json';
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorTexts } from './error-text';
import { type SignInCodeLabels, SignInCodeStep } from './sign-in-code-step';

/**
 * The six-box code screen, without Auth (WP-ADM-05, FR-IAM-12; PO 23 Oct 2026): the per-PR CI has no Supabase Auth,
 * so the screen is checked here on every change with the server actions mocked, in Arabic and English with the
 * real messages. The whole journey against a real stack is `e2e/sign-in-code.spec.ts` (nightly, gate 15).
 */
const { signInWithCodeAction, requestSignInCodeAction, replace, refresh } = vi.hoisted(() => ({
  signInWithCodeAction: vi.fn(),
  requestSignInCodeAction: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('../../auth/actions', () => ({ signInWithCodeAction, requestSignInCodeAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

type Messages = typeof en;
const MESSAGES: Record<'ar' | 'en', Messages> = { en, ar };
const EMAIL = 'nobody@example.test';

function labelsOf(messages: Messages): SignInCodeLabels {
  const c = messages.auth.signInCode;
  return {
    intro: c.intro,
    label: c.label,
    digit: c.digit,
    spam: c.spam,
    remember: c.remember,
    rememberHint: c.rememberHint,
    submit: c.submit,
    submitting: c.submitting,
    resendIn: c.resendIn,
    resend: c.resend,
    resendLead: c.resendLead,
    resending: c.resending,
    resent: c.resent,
    resendReady: c.resendReady,
    errFormat: c.errFormat,
    triesLeft: c.triesLeft,
    lockedHelp: c.lockedHelp,
    usePassword: c.usePassword,
  };
}

function errorsOf(messages: Messages): ErrorTexts {
  const e = messages.auth.errors;
  return {
    'auth.errors.signInCodeInvalid': e.signInCodeInvalid,
    'auth.errors.signInCodeLocked': e.signInCodeLocked,
    'auth.errors.signInCodeTooSoon': e.signInCodeTooSoon,
    'errors.internalError': messages.errors.internalError,
  };
}

let root: Root | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  signInWithCodeAction.mockReset();
  requestSignInCodeAction.mockReset();
  replace.mockReset();
  refresh.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
});

function mount(ui: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(ui));
  return container;
}

/** The boxes use `requestAnimationFrame` to move focus; let those frames run. */
async function frames() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

function setup(locale: 'ar' | 'en', onUsePassword = vi.fn(), resendSeconds = 60) {
  const messages = MESSAGES[locale];
  document.documentElement.setAttribute('lang', locale);
  document.documentElement.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  const container = mount(
    <SignInCodeStep
      locale={locale}
      email={EMAIL}
      resendSeconds={resendSeconds}
      labels={labelsOf(messages)}
      errors={errorsOf(messages)}
      onUsePassword={onUsePassword}
    />,
  );
  return { container, messages, onUsePassword };
}

const box = (n: number) => document.getElementById(`sign-in-code-${String(n)}`) as HTMLInputElement;
const boxes = () => Array.from({ length: 6 }, (_, i) => box(i + 1));
const digitName = (messages: Messages, n: number) =>
  messages.auth.signInCode.digit.replace('{n}', String(n)).replace('{total}', '6');
const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`);

/** Type into a controlled input the way a browser does: set the value, then fire `input`. */
function typeInto(input: HTMLInputElement, text: string) {
  act(() => {
    input.focus();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the native setter, so React's value tracking sees a change
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pasteInto(input: HTMLInputElement, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
  act(() => {
    input.dispatchEvent(event);
  });
}

function pressKey(target: HTMLElement, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function clickSubmit() {
  act(() => {
    (byTestId('sign-in-code-submit') as HTMLButtonElement).click();
  });
}

function fillCode(code: string) {
  pasteInto(box(1), code);
}

describe.each(['en', 'ar'] as const)('sign-in code screen (%s)', (locale) => {
  it('shows the intro with the address, the countdown and the right direction', () => {
    const { messages } = setup(locale);
    expect(document.documentElement.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    expect(byTestId('sign-in-code-intro')?.textContent).toBe(
      messages.auth.signInCode.intro.replace('{email}', EMAIL),
    );
    const countdown = byTestId('sign-in-code-countdown');
    expect(countdown?.getAttribute('role')).toBe('timer');
    expect(countdown?.textContent).toBe(
      messages.auth.signInCode.resendIn.replace('{time}', '1:00'),
    );
    // The digits stay left to right inside a right-to-left page.
    expect(byTestId('sign-in-code')?.getAttribute('dir')).toBe('ltr');
  });

  it('has six boxes, each labelled "Digit n of 6", in a group named by its legend', () => {
    const { messages } = setup(locale);
    const group = document.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe(messages.auth.signInCode.label);
    expect(boxes()).toHaveLength(6);
    boxes().forEach((input, index) => {
      expect(input.getAttribute('aria-label')).toBe(digitName(messages, index + 1));
      expect(group?.contains(input)).toBe(true);
    });
    expect(digitName(messages, 3)).toContain('3');
  });

  it('asks for the one-time-code autofill on the first box only, with a numeric keyboard', () => {
    setup(locale);
    expect(box(1).getAttribute('autocomplete')).toBe('one-time-code');
    for (const input of boxes().slice(1)) expect(input.getAttribute('autocomplete')).toBe('off');
    for (const input of boxes()) expect(input.getAttribute('inputmode')).toBe('numeric');
  });

  it('starts with focus on the first box', async () => {
    setup(locale);
    await frames();
    expect(document.activeElement).toBe(box(1));
  });

  it('moves focus on as digits are typed', async () => {
    setup(locale);
    typeInto(box(1), '4');
    await frames();
    expect(box(1).value).toBe('4');
    expect(document.activeElement).toBe(box(2));
    typeInto(box(2), '2');
    await frames();
    expect(document.activeElement).toBe(box(3));
  });

  it('fills all six boxes from a pasted code', async () => {
    setup(locale);
    pasteInto(box(1), '123456');
    await frames();
    expect(boxes().map((b) => b.value)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(document.activeElement).toBe(box(6));
  });

  it('goes back on Backspace in an empty box', async () => {
    setup(locale);
    typeInto(box(1), '7');
    await frames();
    expect(document.activeElement).toBe(box(2));
    const event = pressKey(box(2), 'Backspace');
    await frames();
    expect(event.defaultPrevented).toBe(true);
    expect(box(1).value).toBe('');
    expect(document.activeElement).toBe(box(1));
  });

  it('says an incomplete code ON the field and keeps focus on the boxes', async () => {
    const { messages } = setup(locale);
    typeInto(box(1), '1');
    await frames();
    clickSubmit();
    await frames();
    const error = byTestId('sign-in-code-error');
    expect(error?.textContent).toContain(messages.auth.signInCode.errFormat);
    expect(error?.getAttribute('role')).toBe('alert');
    for (const input of boxes()) {
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toContain('sign-in-code-error');
    }
    expect(boxes()).toContain(document.activeElement);
    expect(signInWithCodeAction).not.toHaveBeenCalled();
    // The submit button is never disabled just because the code is incomplete.
    expect((byTestId('sign-in-code-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a wrong code with the tries left and returns focus to the first box', async () => {
    const { messages } = setup(locale);
    signInWithCodeAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'SIGN_IN_CODE_INVALID',
        messageKey: 'auth.errors.signInCodeInvalid',
        status: 401,
        params: { tries: 4 },
      },
    });
    fillCode('111111');
    await frames();
    clickSubmit();
    await frames();
    expect(signInWithCodeAction).toHaveBeenCalledWith({
      email: EMAIL,
      code: '111111',
      remember: false,
    });
    const text = byTestId('sign-in-code-error')?.textContent ?? '';
    expect(text).toContain(messages.auth.errors.signInCodeInvalid);
    const tries = new Intl.PluralRules(locale).select(4);
    const form = (messages.auth.signInCode.triesLeft as Record<string, string>)[tries];
    expect(text).toContain((form ?? '').replace('{n}', '4'));
    expect(boxes().map((b) => b.value)).toEqual(['', '', '', '', '', '']);
    expect(document.activeElement).toBe(box(1));
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the locked state as a banner, disables the boxes and offers the password', async () => {
    const { messages } = setup(locale);
    signInWithCodeAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'SIGN_IN_CODE_LOCKED',
        messageKey: 'auth.errors.signInCodeLocked',
        status: 429,
      },
    });
    fillCode('222222');
    await frames();
    clickSubmit();
    await frames();
    const banner = byTestId('sign-in-code-banner');
    expect(banner?.textContent).toContain(messages.auth.errors.signInCodeLocked);
    expect(banner?.textContent).toContain(messages.auth.signInCode.lockedHelp);
    for (const input of boxes()) expect(input.disabled).toBe(true);
    expect((byTestId('sign-in-code-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(byTestId('sign-in-code-countdown')).toBeNull();
    expect(byTestId('sign-in-code-use-password')).not.toBeNull();
  });

  it('goes on to the destination after a right code', async () => {
    setup(locale);
    signInWithCodeAction.mockResolvedValue({ ok: true, value: { next: 'dashboard' } });
    fillCode('333333');
    await frames();
    clickSubmit();
    await frames();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(String(replace.mock.calls[0]?.[0])).toContain(`/${locale}`);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('calls back when the person chooses the password instead', () => {
    const { messages, onUsePassword } = setup(locale);
    const button = byTestId('sign-in-code-use-password') as HTMLButtonElement;
    expect(button.textContent).toBe(messages.auth.signInCode.usePassword);
    act(() => {
      button.click();
    });
    expect(onUsePassword).toHaveBeenCalledTimes(1);
  });

  it('offers a new code once the countdown has ended', () => {
    const { messages } = setup(locale, vi.fn(), 0);
    expect(byTestId('sign-in-code-countdown')).toBeNull();
    expect(byTestId('sign-in-code-resend')?.textContent).toBe(messages.auth.signInCode.resend);
  });
});
