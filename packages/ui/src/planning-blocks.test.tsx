// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState, ProgressBar } from './index';

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
