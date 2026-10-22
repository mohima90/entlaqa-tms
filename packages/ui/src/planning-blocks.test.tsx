// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState, ProgressBar, StepList, type StepListItem } from './index';

/** Redesign package 4 (Planning & courses) building blocks: markup and states. */
function html(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(ui);
  return container;
}

describe('ProgressBar', () => {
  it('is a native progress bar named in words, clamped to its range (no inline style)', () => {
    const root = html(<ProgressBar value={4} max={9} label="4 of 9 submitted" />);
    const bar = root.querySelector('progress');
    expect(bar?.getAttribute('aria-label')).toBe('4 of 9 submitted');
    expect(bar?.getAttribute('value')).toBe('4');
    expect(bar?.getAttribute('max')).toBe('9');
    expect(bar?.getAttribute('style')).toBeNull();
    const over = html(<ProgressBar value={12} max={9} label="x" />).querySelector('progress');
    expect(over?.getAttribute('value')).toBe('9');
    // Nothing in scope: an empty bar, never a division by zero.
    const none = html(<ProgressBar value={0} max={0} label="x" />).querySelector('progress');
    expect(none?.getAttribute('max')).toBe('1');
    expect(none?.getAttribute('value')).toBe('0');
  });
});

describe('StepList', () => {
  const items: StepListItem[] = [
    {
      key: 'basics',
      label: 'Basics',
      href: '#b',
      state: 'problem',
      note: 'needs attention',
      srNote: '(needs attention)',
    },
    { key: 'scope', label: 'Scope', href: '#s', state: 'done', srNote: '(completed)' },
    { key: 'budget', label: 'Budget', href: '#u', state: 'todo', note: 'optional' },
    { key: 'review', label: 'Review & launch', state: 'locked', icon: 'flag' },
  ];

  it('marks the current step, says each mark in words and shows locked steps as text', () => {
    const root = html(
      <StepList label="Set-up steps" items={items} current="budget" short="Step 3 of 4 · Budget" />,
    );
    expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe('Set-up steps');
    const links = root.querySelectorAll('ol a');
    expect(links).toHaveLength(3);
    expect(root.querySelector('a[aria-current="step"]')?.textContent).toContain('Budget');
    expect(root.textContent).toContain('(needs attention)');
    expect(root.textContent).toContain('(completed)');
    const locked = root.querySelector('[aria-disabled="true"]');
    expect(locked?.textContent).toContain('Review & launch');
    // Phones: one line with the step and a segmented bar.
    expect(root.textContent).toContain('Step 3 of 4 · Budget');
  });
});

describe('EmptyState steps', () => {
  it('gives the first-use steps a heading for screen readers, one level below the title', () => {
    const root = html(
      <EmptyState
        title="No cycles yet"
        stepsTitle="How a cycle works"
        steps={[{ title: 'Set up' }]}
      />,
    );
    expect(root.querySelector('h2')?.textContent).toBe('No cycles yet');
    expect(root.querySelector('h3.sr-only')?.textContent).toBe('How a cycle works');
    expect(root.querySelectorAll('ol > li')).toHaveLength(1);
  });
});
