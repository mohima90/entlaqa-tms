'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * A refused submit moves the focus to the first field that carries an error (WCAG 3.3.1; review of
 * T-M3-20), as the other forms of the app do: a screen reader then reads the field with its message
 * (`aria-invalid`, `aria-describedby`) instead of nothing. «First» is the order of the page. While the
 * form is busy its fields are disabled and cannot take the focus, so the move waits until it is not.
 */
export function useFocusInvalid(busy: boolean) {
  const form = useRef<HTMLFormElement>(null);
  const [refusals, setRefusals] = useState(0);
  const handled = useRef(0);
  useEffect(() => {
    if (busy || handled.current === refusals) return;
    handled.current = refusals;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [busy, refusals]);
  return {
    form,
    /** Call with the errors of a refusal (the page's own checks or the server's). */
    focusInvalid: () => {
      setRefusals((count) => count + 1);
    },
  };
}
