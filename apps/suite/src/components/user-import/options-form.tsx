'use client';
import { ChoiceCard } from '@jadarat/ui';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useId, useSyncExternalStore, useTransition } from 'react';

export type ExistingChoice = 'skip' | 'upsert' | 'update_only';
export type InvitationsChoice = 'send' | 'hold';

export interface ImportOptions {
  readonly existing: ExistingChoice;
  readonly defaultRole: string;
  readonly invitations: InvitationsChoice;
}

const EXISTING: readonly ExistingChoice[] = ['skip', 'upsert', 'update_only'];
const INVITATIONS: readonly InvitationsChoice[] = ['send', 'hold'];

/** The address of the confirmation with these options (the server reads them from there, as before). */
function confirmHref(pathname: string, options: ImportOptions): string {
  const query = new URLSearchParams({
    step: 'confirm',
    existing: options.existing,
    defaultRole: options.defaultRole,
    invitations: options.invitations,
  });
  return `${pathname}?${query.toString()}`;
}

/*
 * Option changes still loading (the confirmation's «Start import» sends the options of the page as the
 * server last showed it, so it waits until a newer choice has arrived; review, 21 Oct 2026).
 */
const changing = new Set<string>();
const listeners = new Set<() => void>();
function setChanging(id: string, on: boolean): void {
  const had = changing.has(id);
  if (on) changing.add(id);
  else changing.delete(id);
  if (had !== on) for (const listener of listeners) listener();
}
function subscribeChanging(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const anyChanging = () => changing.size > 0;

/** True while a changed option is still being applied to the confirmation. */
export function useOptionsChanging(): boolean {
  return useSyncExternalStore(subscribeChanging, anyChanging, () => false);
}

/** A change of option: the confirmation reads its counts again for it (no other state). */
function useChoose(options: ImportOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const id = useId();
  useEffect(() => {
    setChanging(id, pending);
    return () => {
      setChanging(id, false);
    };
  }, [id, pending]);
  const choose = (changes: Partial<ImportOptions>) => {
    startTransition(() => {
      router.replace(confirmHref(pathname, { ...options, ...changes }), { scroll: false });
    });
  };
  return { choose, pending };
}

/**
 * «Invitations» on the confirmation (approved screen 7; redesign package 3 — the options sit inside the
 * confirmation, next to the counts they change): send them when the import ends (default) or add the
 * people without sending them now. A choice applies at once; the statements above it follow.
 */
export function InvitationsChoiceCards({
  options,
  labels,
}: {
  readonly options: ImportOptions;
  readonly labels: Readonly<Record<string, string>>;
}) {
  const text = (key: string) => labels[key] ?? key;
  const { choose, pending } = useChoose(options);
  return (
    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0" aria-busy={pending || undefined}>
      <legend className="sr-only">{text('invitationsHeading')}</legend>
      {INVITATIONS.map((value) => (
        <ChoiceCard
          key={value}
          id={`invitations-${value}`}
          name="invitations"
          value={value}
          checked={options.invitations === value}
          onChange={() => {
            choose({ invitations: value });
          }}
          title={text(`invitations.${value}`)}
          description={text(`invitations.${value}Hint`)}
          data-testid={`invitations-card-${value}`}
        />
      ))}
    </fieldset>
  );
}

/** «People already in the organization»: skip (default), add and update, or update only. */
export function ExistingChoiceCards({
  options,
  canUpdate,
  labels,
}: {
  readonly options: ImportOptions;
  /** May update existing people's data (platform.user.update). */
  readonly canUpdate: boolean;
  readonly labels: Readonly<Record<string, string>>;
}) {
  const text = (key: string) => labels[key] ?? key;
  const { choose, pending } = useChoose(options);
  return (
    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0" aria-busy={pending || undefined}>
      <legend className="sr-only">{text('existingHeading')}</legend>
      {EXISTING.map((value) => {
        const disabled = value !== 'skip' && !canUpdate;
        return (
          <ChoiceCard
            key={value}
            id={`existing-${value}`}
            name="existing"
            value={value}
            checked={options.existing === value}
            disabled={disabled}
            onChange={() => {
              choose({ existing: value });
            }}
            title={text(`existing.${value}`)}
            description={text(`existing.${value}Hint`)}
            note={disabled ? text('updateNotAllowed') : undefined}
            data-testid={`existing-card-${value}`}
          />
        );
      })}
    </fieldset>
  );
}

/** «Default primary role» for rows without one (non-privileged roles only). */
export function DefaultRoleSelect({
  options,
  roles,
  labels,
  extra,
}: {
  readonly options: ImportOptions;
  readonly roles: readonly { readonly code: string; readonly name: string }[];
  readonly labels: Readonly<Record<string, string>>;
  readonly extra?: ReactNode;
}) {
  const text = (key: string) => labels[key] ?? key;
  const { choose } = useChoose(options);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="default-role" className="font-semibold">
        {text('defaultRole')}
      </label>
      <select
        id="default-role"
        name="defaultRole"
        value={options.defaultRole}
        onChange={(event) => {
          choose({ defaultRole: event.target.value });
        }}
        aria-describedby="default-role-hint default-role-privileged"
        className="select-chevron min-h-11 rounded-md border border-border-strong bg-surface ps-4 pe-10 text-[15px] text-text"
        data-testid="default-role"
      >
        {roles.map((role) => (
          <option key={role.code} value={role.code}>
            {role.name}
          </option>
        ))}
      </select>
      <p id="default-role-hint" className="m-0 text-sm text-text-muted">
        {text('defaultRoleHint')}
      </p>
      <p id="default-role-privileged" className="m-0 text-sm text-text-muted">
        {text('privilegedNote')}
      </p>
      {extra}
    </div>
  );
}
