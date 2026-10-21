'use client';
import { useEffect } from 'react';

/*
 * Focus after a panel or dialog closed by navigating (redesign package 3): the side panels of a person and
 * the invite panel have their own addresses (`/users/[id]/edit`, `/users/invite`), so closing one loads the
 * page behind it again and the element that opened it is a new element. The closing panel names that
 * element's id here; the page behind focuses it once it is shown (WCAG 2.4.3: focus returns to the opener).
 */
let pending: string | null = null;

/** Remember where focus goes once the next page is shown. */
export function returnFocusTo(id: string): void {
  pending = id;
}

/** On the page behind: focuses the remembered element, once. */
export function useReturnedFocus(): void {
  useEffect(() => {
    if (pending === null) return;
    const element = document.getElementById(pending);
    if (element) {
      pending = null;
      element.focus();
    }
  });
}

/** The component form of `useReturnedFocus`, for server-rendered pages. */
export function ReturnedFocus(): null {
  useReturnedFocus();
  return null;
}
