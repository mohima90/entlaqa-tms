'use client';

import { createContext } from 'react';

/** State of the side navigation that its entries need (provided by `AppShell`). */
export interface NavState {
  /** The desktop navigation is collapsed to icons (the phone drawer is always expanded). */
  readonly collapsed: boolean;
}

export const NavStateContext = createContext<NavState>({ collapsed: false });
