'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './icons';

/**
 * Menus of the top bar and row menus (direction C: 16–18 px corners, a raised surface, a deep shadow;
 * Radix): a menu button (`aria-haspopup`, `aria-expanded`),
 * arrow keys between items, typeahead, Escape closes and focus returns to the button. Non-modal: the
 * page is not scroll-locked (no runtime <style>, which the CSP refuses).
 */
export function DropdownMenu({
  children,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Menu.Root>, 'modal'>) {
  return (
    <Menu.Root modal={false} {...props}>
      {children}
    </Menu.Root>
  );
}

export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 8,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-[1000] min-w-[13.75rem] overflow-hidden rounded-lg border border-border bg-surface-raised p-1.5 text-sm text-text shadow-4',
          className,
        )}
        {...props}
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

const itemClasses =
  'relative flex min-h-10.5 cursor-pointer select-none items-center gap-2.5 rounded-sm px-3 py-2 text-[14.5px] text-text no-underline outline-none data-[highlighted]:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:text-text-disabled pointer-coarse:min-h-11';

export function DropdownMenuItem({
  className,
  tone = 'default',
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Item> & { readonly tone?: 'default' | 'danger' }) {
  return (
    <Menu.Item
      className={cn(itemClasses, tone === 'danger' && 'text-danger', className)}
      {...props}
    />
  );
}

export const DropdownMenuRadioGroup = Menu.RadioGroup;

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(itemClasses, 'pe-8', className)} {...props}>
      {children}
      <Menu.ItemIndicator className="absolute end-2.5 inline-flex">
        <Icon name="check" />
      </Menu.ItemIndicator>
    </Menu.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Label>) {
  return (
    <Menu.Label
      className={cn('px-2.5 py-1.5 text-xs font-semibold text-text-muted', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

/** Non-interactive content at the top of a menu (e.g. the account's name), outside the item list. */
export function DropdownMenuHeader({ children }: { readonly children: ReactNode }) {
  return <div className="m-1 rounded-md bg-surface-sunken p-3">{children}</div>;
}
