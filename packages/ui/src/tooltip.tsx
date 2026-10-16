'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface TooltipProps {
  /** The element it describes (a focusable control, or an element that is only hovered). */
  readonly children: ReactNode;
  readonly content: ReactNode;
  /** Which side, in reading order: `end` = right in English, left in Arabic. */
  readonly side?: 'start' | 'end' | 'top' | 'bottom' | undefined;
  /** Set false to never show it (e.g. the expanded navigation, where the label is visible). */
  readonly enabled?: boolean | undefined;
}

/** Wraps a part of the page in which tooltips open at once (Kawadir: delay 0). */
export function TooltipProvider({ children }: { readonly children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={0} skipDelayDuration={0}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/**
 * A short label on hover and keyboard focus (Kawadir: dark pill, 12 px text), dismissed with Escape
 * (WCAG 1.4.13). Never the only place of information a control needs: give the control its own name.
 */
export function Tooltip({ children, content, side = 'top', enabled = true }: TooltipProps) {
  if (!enabled) return <>{children}</>;
  // Its own provider (delay 0, Kawadir), so a tooltip works anywhere, with or without TooltipProvider.
  return (
    <TooltipPrimitive.Provider delayDuration={0} skipDelayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={physicalSide(side)}
            sideOffset={8}
            className={cn(
              'z-[1600] max-w-xs rounded-lg bg-inverse-surface px-3 py-1.5 text-xs font-medium text-inverse-text shadow-2',
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/** Radix positions physically; `start`/`end` follow the document direction. */
function physicalSide(
  side: NonNullable<TooltipProps['side']>,
): 'top' | 'bottom' | 'left' | 'right' {
  if (side === 'top' || side === 'bottom') return side;
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  if (side === 'end') return rtl ? 'left' : 'right';
  return rtl ? 'right' : 'left';
}
