'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { Avatar } from './avatar';
import { initialsOf } from './initials';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHeader,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { EmptyState } from './empty-state';
import { Icon, type IconName } from './icons';
import { type Shortcut, ShortcutsDialog } from './shortcuts-dialog';
import { THEME_MODES, type ThemeMode, applyThemeMode } from './shell-preferences';

/**
 * Icon-only buttons of the top bar (direction C): 44 px round, outlined, muted icon (40 px on phones,
 * still ≥ 24 px targets with spacing; 44 px on touch screens).
 */
export const topBarButtonClasses =
  'relative grid size-10 shrink-0 place-items-center rounded-full border border-border bg-surface text-text-muted transition-colors hover:bg-surface-hover hover:text-text pointer-coarse:size-11 md:size-11';

const THEME_ICON: Record<ThemeMode, IconName> = { light: 'sun', dark: 'moon', system: 'monitor' };

export interface ThemeMenuProps {
  /** The mode the page was rendered with (from the device's cookie). */
  readonly initial: ThemeMode;
  readonly texts: {
    /** «المظهر» / "Theme" — the button says "Theme: Light". */
    readonly label: string;
    readonly light: string;
    readonly dark: string;
    readonly system: string;
  };
}

/** Light / dark / system (Kawadir), remembered on this device. */
export function ThemeMenu({ initial, texts }: ThemeMenuProps) {
  const [mode, setMode] = useState<ThemeMode>(initial);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={topBarButtonClasses}
        aria-label={`${texts.label}: ${texts[mode]}`}
        data-testid="theme-menu"
      >
        <Icon name={THEME_ICON[mode]} className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44" aria-label={texts.label}>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            const next = THEME_MODES.find((m) => m === value) ?? 'system';
            setMode(next);
            applyThemeMode(next);
          }}
        >
          {THEME_MODES.map((m) => (
            <DropdownMenuRadioItem key={m} value={m}>
              <Icon name={THEME_ICON[m]} />
              {texts[m]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface NotificationBellProps {
  readonly texts: {
    /** «الإشعارات» / "Notifications". */
    readonly label: string;
    readonly emptyTitle: string;
    readonly emptyBody: string;
  };
}

/**
 * The notification bell (Kawadir) — a placeholder until in-app notifications exist (FR-NTF-01): a
 * disclosure button with a small panel that says there is nothing yet. Escape or a click outside
 * closes it; Escape returns focus to the bell.
 */
export function NotificationBell({ texts }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={texts.label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className={topBarButtonClasses}
        data-testid="notification-bell"
      >
        <Icon name="bell" className="size-5" />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute end-0 top-full z-[1000] mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface text-text shadow-2"
      >
        <h2 className="m-0 border-b border-border px-4 py-3 text-sm font-semibold">
          {texts.label}
        </h2>
        <EmptyState
          icon="bell"
          title={texts.emptyTitle}
          description={texts.emptyBody}
          headingLevel={3}
          className="py-8"
        />
      </div>
    </div>
  );
}

export interface UserMenuProps {
  readonly name: string;
  /** "Organization · Role" (Kawadir), or the organization alone. */
  readonly subtitle: string;
  readonly profileHref: string;
  readonly texts: {
    /** «ملفي الشخصي» / "My profile". */
    readonly profile: string;
    /** «تسجيل الخروج» / "Sign out" — omitted when sign-in is not configured. */
    readonly signOut?: string | undefined;
    readonly signingOut?: string | undefined;
  };
  /** Ends the session (server action) and leaves the page; shown only with `texts.signOut`. */
  readonly onSignOut?: (() => Promise<void>) | undefined;
  /** The current page is My profile. */
  readonly profileCurrent?: boolean | undefined;
  /** The person's photo, when they have one (initials otherwise). */
  readonly photo?: string | undefined;
  /** The keyboard shortcuts list (a menu entry that opens it in a small dialog). */
  readonly shortcuts?:
    | {
        readonly title: string;
        readonly closeLabel: string;
        readonly items: readonly Shortcut[];
      }
    | undefined;
}

/**
 * The account menu (direction C): the avatar on the brand gradient; inside, the picture, name and
 * "Organization · Role", My profile, the keyboard shortcuts list (when given) and sign out.
 */
export function UserMenu({
  name,
  subtitle,
  profileHref,
  texts,
  onSignOut,
  profileCurrent = false,
  photo,
  shortcuts,
}: UserMenuProps) {
  const [pending, startTransition] = useTransition();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          className="flex shrink-0 items-center rounded-full text-start text-on-header"
          data-testid="account-menu"
        >
          {photo ? (
            <Avatar name={name} src={photo} className="size-10 md:size-11" />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-gradient text-sm font-semibold text-on-brand md:size-11"
            >
              {initialsOf(name)}
            </span>
          )}
          {/* The name says whose account it is (the avatar is decorative). */}
          <span className="sr-only">
            {name}, {subtitle}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          <DropdownMenuHeader>
            <div className="flex items-center gap-3">
              <Avatar name={name} size="md" src={photo} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">{name}</span>
                <span className="truncate text-xs text-text-muted">{subtitle}</span>
              </div>
            </div>
          </DropdownMenuHeader>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a
              href={profileHref}
              aria-current={profileCurrent ? 'page' : undefined}
              data-testid="my-profile-link"
            >
              <Icon name="user" className="text-text-muted" />
              {texts.profile}
            </a>
          </DropdownMenuItem>
          {shortcuts ? (
            <DropdownMenuItem
              data-testid="shortcuts-open"
              onSelect={() => {
                setShowShortcuts(true);
              }}
            >
              <Icon name="keyboard" className="text-text-muted" />
              {shortcuts.title}
            </DropdownMenuItem>
          ) : null}
          {texts.signOut && onSignOut ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                tone="danger"
                disabled={pending}
                data-testid="sign-out"
                onSelect={(event) => {
                  event.preventDefault();
                  startTransition(async () => {
                    await onSignOut();
                  });
                }}
              >
                <Icon name="sign-out" />
                {pending ? (texts.signingOut ?? texts.signOut) : texts.signOut}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {shortcuts ? (
        <ShortcutsDialog
          open={showShortcuts}
          onClose={() => {
            setShowShortcuts(false);
            // Back to the account menu's button (the menu item that opened the list is gone).
            trigger.current?.focus();
          }}
          {...shortcuts}
        />
      ) : null}
    </>
  );
}
