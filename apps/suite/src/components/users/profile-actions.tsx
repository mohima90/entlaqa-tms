'use client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  type IconName,
  buttonClasses,
} from '@jadarat/ui';
import Link from 'next/link';
import { useReturnedFocus } from '../../lib/focus-return';

export interface ProfileActionLink {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
  /** «Deactivate user»: red, last, after a separator. */
  readonly danger?: boolean;
}

/**
 * The actions at the top of a person's profile (redesign package 3 — QuickBooks' «Actions ▾»): «Edit
 * details» as a button, the rest in one menu — Change role, the sign-in and security tasks, then
 * «Deactivate user» in red at the bottom. Each opens its panel or dialog by its own address; only the
 * actions the member may take are offered (deny by default, as before). Focus comes back here when a panel
 * closes.
 */
export function ProfileActions({
  edit,
  menuLabel,
  items,
}: {
  readonly edit: { readonly label: string; readonly href: string } | null;
  readonly menuLabel: string;
  readonly items: readonly ProfileActionLink[];
}) {
  useReturnedFocus();
  const ordinary = items.filter((item) => !item.danger);
  const danger = items.filter((item) => item.danger);
  return (
    <>
      {edit ? (
        <Link
          id="profile-edit"
          href={edit.href}
          scroll={false}
          className={buttonClasses({ variant: 'secondary', size: 'md' })}
          data-testid="edit-user-link"
        >
          <Icon name="pencil" className="size-4" />
          {edit.label}
        </Link>
      ) : null}
      {items.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            id="profile-actions"
            className={buttonClasses({ variant: 'secondary', size: 'md' })}
            data-testid="profile-actions"
          >
            {menuLabel}
            <Icon name="chevron-down" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {ordinary.map((item) => (
              <DropdownMenuItem key={item.key} asChild>
                <Link href={item.href} scroll={false} data-testid={`profile-action-${item.key}`}>
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}
            {danger.length > 0 && ordinary.length > 0 ? <DropdownMenuSeparator /> : null}
            {danger.map((item) => (
              <DropdownMenuItem key={item.key} asChild tone="danger">
                <Link href={item.href} scroll={false} data-testid={`profile-action-${item.key}`}>
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
