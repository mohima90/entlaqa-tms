// @vitest-environment happy-dom
import { act, useState } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFormBase } from './latest-version';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/**
 * Review H1 (12 Nov 2026): a form keeps its fields in state; when the page loads a newer copy underneath, the
 * form must never send the newer version with its older fields — the next save would overwrite the other
 * person's change without a conflict. A minimal form with the hook, as the cycle set-up forms use it.
 */
function Form({ version, initial }: { version: number; initial: string }) {
  const [value, setValue] = useState(initial);
  const base = useFormBase(
    { version, initial },
    (from) => value !== from,
    (latest) => {
      setValue(latest);
    },
  );
  return (
    <form>
      <input
        aria-label="amount"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      <output data-testid="sends">{String(base.version)}</output>
      <output data-testid="dirty">{String(base.dirty)}</output>
    </form>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

const show = (version: number, initial: string) => {
  act(() => {
    root.render(<Form version={version} initial={initial} />);
  });
};
const input = () => host.querySelector('input')!;
const text = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent;
const type = (value: string) => {
  act(() => {
    // The prototype's setter, so React sees the change (its own tracker wraps the instance's `value`).
    Reflect.set(HTMLInputElement.prototype, 'value', value, input());
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('useFormBase (review H1)', () => {
  it('an untouched form shows the latest values and sends the latest version', () => {
    show(4, '100');
    show(5, '250'); // someone else saved; the page reloaded underneath
    expect(input().value).toBe('250');
    expect(text('sends')).toBe('5');
    expect(text('dirty')).toBe('false');
  });

  it('a form with typed entries keeps them and the version they were based on', () => {
    show(4, '100');
    type('180');
    show(5, '250');
    expect(input().value).toBe('180');
    // Version 4: the save is refused as a conflict, never applied over the other person's 250.
    expect(text('sends')).toBe('4');
    expect(text('dirty')).toBe('true');
  });

  it('is not marked unsaved by a reload alone, and follows later copies while untouched', () => {
    show(4, '100');
    show(5, '250');
    show(6, '300');
    expect(input().value).toBe('300');
    expect(text('sends')).toBe('6');
    expect(text('dirty')).toBe('false');
  });

  it('typing the base value back makes the form clean again, and it then takes the latest', () => {
    show(4, '100');
    type('180');
    show(5, '250');
    type('100');
    expect(input().value).toBe('250');
    expect(text('sends')).toBe('5');
  });
});
