'use client';
import { cn } from '@jadarat/ui';
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
  useImperativeHandle,
  useRef,
} from 'react';
import { CODE_LENGTH, applyBackspace, applyPaste, applyTyping } from '../../lib/sign-in-code-ui';

/**
 * The six boxes of an e-mailed sign-in code (WP-ADM-05, design adm05-signin, WCAG 2.2 AA): one digit per box,
 * big monospace digits; a group named by its legend, every box named «Digit n of 6»; `inputMode="numeric"`; the
 * first box asks for the browser's one-time-code autofill (a code arriving whole in one box is spread over the
 * six), paste fills all six, Backspace in an empty box goes back, the arrows move between boxes. The boxes always
 * read left to right, also in Arabic (digits stay Latin). The error is said under the boxes by the caller
 * (`errorId` names it: every box is described by it and marked invalid).
 */
export interface CodeBoxesHandle {
  /** Focus the first empty box (the last one when the code is complete). */
  focus(): void;
}

export interface CodeBoxesProps {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** «Digit {n} of {total}» for box `n` (1-based). */
  readonly boxLabel: (n: number, total: number) => string;
  /** The group's visible or screen-reader name (the field's label). */
  readonly legend: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  /** Ids of the error / hint lines that describe the group. */
  readonly describedBy?: string | undefined;
  readonly ref?: Ref<CodeBoxesHandle>;
}

export function CodeBoxes({
  id,
  value,
  onChange,
  boxLabel,
  legend,
  disabled,
  invalid,
  describedBy,
  ref,
}: CodeBoxesProps) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const focusBox = (index: number) => {
    // After the state update the boxes re-render; focus on the next frame.
    requestAnimationFrame(() => {
      const box = inputs.current[Math.min(Math.max(index, 0), CODE_LENGTH - 1)];
      box?.focus();
      box?.select();
    });
  };
  useImperativeHandle(ref, () => ({
    focus: () => {
      const box = inputs.current[Math.min(value.length, CODE_LENGTH - 1)];
      box?.focus();
    },
  }));

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === 'Backspace') {
      const back = applyBackspace(value, index);
      if (back) {
        event.preventDefault();
        onChange(back.value);
        focusBox(back.focus);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusBox(index + 1);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = applyPaste(event.clipboardData.getData('text'));
    onChange(pasted.value);
    focusBox(pasted.focus);
  }

  return (
    <div
      role="group"
      aria-label={legend}
      aria-describedby={describedBy}
      dir="ltr"
      className="flex justify-center gap-2 sm:gap-3"
      data-testid={id}
    >
      {Array.from({ length: CODE_LENGTH }, (_, index) => (
        <input
          key={index}
          ref={(node) => {
            inputs.current[index] = node;
          }}
          id={`${id}-${String(index + 1)}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          autoCorrect="off"
          spellCheck={false}
          aria-label={boxLabel(index + 1, CODE_LENGTH)}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          value={value[index] ?? ''}
          onChange={(event) => {
            const typed = applyTyping(value, index, event.target.value);
            onChange(typed.value);
            focusBox(typed.focus);
          }}
          onKeyDown={(event) => {
            onKeyDown(event, index);
          }}
          onPaste={onPaste}
          onFocus={(event) => {
            event.target.select();
          }}
          className={cn(
            'h-14 w-11 min-w-0 rounded-md border-[1.5px] bg-surface text-center font-mono text-2xl font-semibold text-text sm:h-16 sm:w-13',
            'transition-[border-color,box-shadow] duration-[var(--duration-base)] focus:border-primary',
            'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-muted',
            invalid ? 'border-danger' : 'border-border-strong',
          )}
          data-testid={`${id}-box`}
        />
      ))}
    </div>
  );
}
