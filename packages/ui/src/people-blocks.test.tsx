// @vitest-environment happy-dom
import { type ReactNode, act, useState } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AttentionItem,
  AttentionStrip,
  Avatar,
  ChoiceCard,
  CopyButton,
  FilterMenu,
  PageHeader,
  SidePanel,
  toastStore,
} from './index';

/** Redesign package 3 (People & roles) building blocks: markup, states and keyboard behaviour. */
let root: Root | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  toastStore.clear();
  vi.restoreAllMocks();
});

function mount(ui: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(ui));
  return container;
}

const UNITS = [
  { value: 'u1', label: 'Finance' },
  { value: 'u2', label: 'Accounts', depth: 1 },
  { value: 'u3', label: 'Payroll', depth: 1 },
];

describe('ChoiceCard (radio rows with what each choice means)', () => {
  function Group({ onChange }: { readonly onChange: (v: string) => void }) {
    const [value, setValue] = useState('a');
    return (
      <>
        {['a', 'b', 'c'].map((key) => (
          <ChoiceCard
            key={key}
            id={`choice-${key}`}
            name="choice"
            value={key}
            checked={value === key}
            disabled={key === 'c'}
            note={key === 'c' ? 'Not available to you' : undefined}
            onChange={(next) => {
              setValue(next);
              onChange(next);
            }}
            title={`Role ${key}`}
            description={`What ${key} does`}
            data-testid={`card-${key}`}
          >
            <span data-testid={`extra-${key}`}>extra</span>
          </ChoiceCard>
        ))}
      </>
    );
  }

  it('a native radio named by the title and described by the meaning; the extra fields only when chosen', () => {
    const onChange = vi.fn();
    const container = mount(<Group onChange={onChange} />);
    const radio = container.querySelector<HTMLInputElement>('#choice-b')!;
    expect(radio.type).toBe('radio');
    expect(container.querySelector('label[for="choice-b"]')?.textContent).toBe('Role b');
    expect(radio.getAttribute('aria-describedby')).toBe('choice-b-description');
    expect(container.querySelector('[data-testid="extra-a"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="extra-b"]')).toBeNull();
    act(() => {
      radio.click();
    });
    expect(onChange).toHaveBeenCalledWith('b');
    expect(container.querySelector('[data-testid="card-b"]')?.getAttribute('data-checked')).toBe(
      'true',
    );
    expect(container.querySelector('[data-testid="extra-b"]')).not.toBeNull();
  });

  it('an unavailable choice stays listed, disabled, with the reason read with it', () => {
    const container = mount(<Group onChange={vi.fn()} />);
    const radio = container.querySelector<HTMLInputElement>('#choice-c')!;
    expect(radio.disabled).toBe(true);
    expect(radio.getAttribute('aria-describedby')).toBe('choice-c-description choice-c-note');
    expect(container.querySelector('#choice-c-note')?.textContent).toBe('Not available to you');
  });
});

describe('FilterMenu (a filter pill that applies at once)', () => {
  it('unset: a dashed «+» pill; it opens the choices and a choice applies immediately', () => {
    const onChange = vi.fn();
    const container = mount(
      <FilterMenu
        label="Unit"
        value={null}
        options={UNITS}
        allLabel="All units"
        onChange={onChange}
        removeLabel="Remove the filter Unit"
        data-testid="unit"
      />,
    );
    const pill = container.querySelector<HTMLButtonElement>('button[aria-haspopup]')!;
    expect(pill.textContent).toBe('Unit');
    expect(pill.className).toContain('border-dashed');
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    act(() => {
      pill.click();
    });
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    const group = container.querySelector('[role="group"][aria-label="Unit"]')!;
    const choices = [...group.querySelectorAll('button')];
    expect(choices.map((b) => b.textContent)).toEqual([
      'All units',
      'Finance',
      'Accounts',
      'Payroll',
    ]);
    expect(choices[0]?.getAttribute('aria-pressed')).toBe('true');
    // Short lists have no search field.
    expect(group.querySelector('input')).toBeNull();
    act(() => {
      choices[2]?.click();
    });
    expect(onChange).toHaveBeenCalledWith('u2');
    expect(container.querySelector('[role="group"]')).toBeNull();
  });

  it('set: the value in a solid pill with «×» that removes the filter; ↓ moves through the choices, Esc closes', () => {
    const onChange = vi.fn();
    const container = mount(
      <FilterMenu
        label="Unit"
        value="u3"
        options={UNITS}
        allLabel="All units"
        onChange={onChange}
        removeLabel="Remove the filter Unit: Payroll"
        searchLabel="Search in the list"
        searchFrom={3}
        noMatches="Nothing matches."
      />,
    );
    const pill = container.querySelector<HTMLButtonElement>('button[aria-haspopup]')!;
    expect(pill.textContent).toBe('Unit: Payroll');
    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove the filter Unit: Payroll"]',
    )!;
    act(() => {
      remove.click();
    });
    expect(onChange).toHaveBeenCalledWith(null);

    act(() => {
      pill.click();
    });
    // Long lists start with their search field, focused.
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(document.activeElement).toBe(search);
    act(() => {
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe('All units');
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(document.activeElement).toBe(pill);
  });

  it('the search narrows the choices and says when nothing matches', () => {
    const container = mount(
      <FilterMenu
        label="Unit"
        value={null}
        options={UNITS}
        allLabel="All units"
        onChange={vi.fn()}
        removeLabel="Remove"
        searchLabel="Search in the list"
        searchFrom={3}
        noMatches="Nothing matches."
      />,
    );
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-haspopup]')!.click();
    });
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const type = (value: string) => {
      act(() => {
        // React tracks the value it set: go through the native setter so the change is seen.
        Reflect.set(HTMLInputElement.prototype, 'value', value, search);
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    type('pay');
    expect(
      [...container.querySelectorAll('[role="group"] li button')].map((b) => b.textContent),
    ).toEqual(['Payroll']);
    type('zzz');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Nothing matches.');
  });
});

describe('AttentionStrip', () => {
  it('one titled section, one line per matter with its action', () => {
    const html = renderToStaticMarkup(
      <AttentionStrip title="Needs your attention" data-testid="strip">
        <AttentionItem icon="clock" action={<button type="button">Resend</button>}>
          2 invitations expired.
        </AttentionItem>
        <AttentionItem icon="sync" tone="info">
          Importing…
        </AttentionItem>
      </AttentionStrip>,
    );
    expect(html).toMatch(/<section aria-labelledby="[^"]+"/);
    expect(html).toContain('Needs your attention</h2>');
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain('bg-info-subtle');
    expect(html).toContain('<button type="button">Resend</button>');
  });
});

describe('CopyButton', () => {
  it('copies the value and says so in a toast; a refusal asks to copy by hand', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const container = mount(
      <CopyButton
        value="EMP-1187"
        label="Copy Employee number"
        copiedText="Employee number copied."
        failedText="Select the text and copy it."
      />,
    );
    const button = container.querySelector<HTMLButtonElement>('button')!;
    expect(button.getAttribute('aria-label')).toBe('Copy Employee number');
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('EMP-1187');
    expect(toastStore.items().at(-1)).toMatchObject({
      tone: 'success',
      message: 'Employee number copied.',
    });
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(toastStore.items().at(-1)).toMatchObject({
      tone: 'error',
      message: 'Select the text and copy it.',
    });
  });
});

describe('SidePanel: unsaved changes and sizes', () => {
  it('asks before closing when canClose says no (Escape, the close button)', () => {
    const asked = vi.fn(() => false);
    const onClose = vi.fn();
    const container = mount(
      <SidePanel open onClose={onClose} title="Edit" closeLabel="Close" size="lg" canClose={asked}>
        body
      </SidePanel>,
    );
    const dialog = container.querySelector('dialog')!;
    expect(dialog.className).toContain('w-[600px]');
    const cancel = new Event('cancel', { cancelable: true });
    act(() => {
      dialog.dispatchEvent(cancel);
    });
    expect(asked).toHaveBeenCalled();
    expect(cancel.defaultPrevented).toBe(true);
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    });
    expect(asked).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('profile header', () => {
  it('a large avatar before the title (PageHeader `leading`, Avatar `xl`)', () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Mona Al-Qahtani" leading={<Avatar name="Mona Al-Qahtani" size="xl" />} />,
    );
    expect(html).toContain('size-19');
    expect(html).toContain('rounded-[22px]');
    expect(html.indexOf('MA')).toBeLessThan(html.indexOf('<h1'));
  });
});
