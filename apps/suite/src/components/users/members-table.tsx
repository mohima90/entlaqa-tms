'use client';
import {
  Avatar,
  Badge,
  type BadgeTone,
  CopyButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  ListCard,
  ListCards,
  SidePanel,
  buttonClasses,
  tableClasses,
} from '@jadarat/ui';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { fillText } from '../../lib/fill-text';
import { returnFocusTo, useReturnedFocus } from '../../lib/focus-return';
import type { RoleOption } from '../../lib/role-choice';
import type { ScopeUnitChoice } from '../../lib/structure-view';
import type { ErrorTexts } from '../auth/error-text';
import { ChangeRolePanel, type RoleTarget } from './change-role-panel';
import { ReactivateMemberButton } from './reactivate-member-button';
import type { RoleSelectTexts } from './role-select';
import type { ScopeUnitTexts } from './scope-unit-select';

/** One member row as the list shows it (texts formatted on the server: no hydration differences). */
export interface MemberRowView {
  readonly personId: string;
  readonly name: string;
  readonly email: string | null;
  readonly employeeNumber: string | null;
  /** The role in words, or null with `roleNote` saying why («Not visible to you», «Not set»). */
  readonly roleName: string | null;
  readonly roleNote: string | null;
  /** The unit of a department-limited role: «Covers Finance», or a warning (inactive, none picked). */
  readonly roleUnit: { readonly text: string; readonly warning: boolean } | null;
  readonly unitName: string | null;
  readonly status: 'active' | 'invited' | 'suspended';
  readonly statusText: string;
  readonly lastSignIn: string;
  readonly profileHref: string;
  /** «Edit details» (the profile with its edit panel), when the member may edit this person. */
  readonly editHref: string | null;
  /** «Deactivate user» (the profile with its dialog), when the member may deactivate this person. */
  readonly deactivateHref: string | null;
  /** «Change role» in a panel over the list, when the member may change this person's role. */
  readonly role: Omit<RoleTarget, 'personId' | 'name'> | null;
  /** «Reactivate» on the Deactivated view. */
  readonly reactivate: { readonly privileged: boolean } | null;
}

export interface MembersTableProps {
  readonly rows: readonly MemberRowView[];
  /** The Primary role column (role.read). */
  readonly showRole: boolean;
  /** The unit column's header (the organization's level names). */
  readonly unitHeader: string;
  /** Texts (namespaces `users`, `userProfile`, `invitations.copy`), translated on the server. */
  readonly texts: Readonly<Record<string, string>>;
  /** The change-role panel (null: the member gives no roles). */
  readonly roleMenu: {
    readonly options: readonly RoleOption[];
    readonly selectTexts: RoleSelectTexts;
    readonly scopeUnits: readonly ScopeUnitChoice[];
    readonly unitTexts: ScopeUnitTexts;
    readonly labels: Readonly<Record<string, string>>;
  } | null;
  /** Reactivation texts (namespace `deactivation.reactivate`). */
  readonly reactivateLabels: Readonly<Record<string, string>> | null;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
}

/** A panel opened from a row, and the id of the row's control that gets focus back when it closes. */
interface Opened {
  readonly row: MemberRowView;
  readonly returnId: string;
}

/** The table and the phone cards both render each row: their controls carry different ids. */
type Place = 'table' | 'card';

const STATUS_TONE: Record<MemberRowView['status'], BadgeTone> = {
  active: 'success',
  invited: 'warning',
  suspended: 'neutral',
};

/**
 * The members of Team members (redesign package 3 — Asana's admin users, Plain's peek): a table on wider
 * screens and one card per person on phones (no sideways scrolling). Choosing a person's name opens a quick
 * look in a side panel (copyable facts, «Open full profile», «Change role»); the ⋯ menu holds every action
 * on the person — Open profile, Edit details, Change role, then «Deactivate user» in red. The Employee number
 * column stays (PO). Same permissions as before: each action shows only when the member may take it, and
 * the server checks again.
 */
export function MembersTable(props: MembersTableProps) {
  const { rows, texts } = props;
  const text = (key: string, values: Record<string, string> = {}) =>
    fillText(texts[key] ?? key, values, props.locale);
  const [peek, setPeek] = useState<Opened | null>(null);
  const [roleFor, setRoleFor] = useState<Opened | null>(null);
  // Focus back on the row's ⋯ or name once a panel has closed (WCAG 2.4.3; the opener inside a closed menu
  // or the quick look no longer exists).
  useReturnedFocus();

  const status = (row: MemberRowView) => (
    <Badge tone={STATUS_TONE[row.status]} dot>
      {row.statusText}
    </Badge>
  );

  const role = (row: MemberRowView): ReactNode =>
    row.roleName ? (
      <span className="flex flex-col items-start gap-1">
        <span>{row.roleName}</span>
        {row.roleUnit ? (
          row.roleUnit.warning ? (
            <Badge tone="warning" data-testid="role-unit-warning">
              {row.roleUnit.text}
            </Badge>
          ) : (
            <span className="text-xs text-text-muted" data-testid="role-unit">
              {row.roleUnit.text}
            </span>
          )
        ) : null}
      </span>
    ) : (
      <span className="italic text-text-muted">{row.roleNote}</span>
    );

  const menu = (row: MemberRowView, place: Place) => {
    const triggerId = `member-menu-${place}-${row.personId}`;
    const canRole = props.roleMenu !== null && row.role !== null;
    if (!row.editHref && !canRole && !row.deactivateHref) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid size-9 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
          aria-label={text('moreActions', { name: row.name })}
          id={triggerId}
          data-testid={`member-menu-${row.personId}`}
        >
          <Icon name="more" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <Link href={row.profileHref} data-testid="member-menu-profile">
              <Icon name="user" />
              {text('openProfile')}
            </Link>
          </DropdownMenuItem>
          {row.editHref ? (
            <DropdownMenuItem asChild>
              <Link href={row.editHref} data-testid="member-menu-edit">
                <Icon name="pencil" />
                {text('editDetails')}
              </Link>
            </DropdownMenuItem>
          ) : null}
          {canRole ? (
            <DropdownMenuItem
              onSelect={() => {
                setRoleFor({ row, returnId: triggerId });
              }}
              data-testid="member-menu-edit-role"
            >
              <Icon name="key" />
              {text('changeRole')}
            </DropdownMenuItem>
          ) : null}
          {row.deactivateHref ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild tone="danger">
                <Link href={row.deactivateHref} data-testid="member-menu-deactivate">
                  <Icon name="power" />
                  {text('deactivate')}
                </Link>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const reactivate = (row: MemberRowView) =>
    row.reactivate && props.reactivateLabels ? (
      <ReactivateMemberButton
        personId={row.personId}
        name={row.name}
        privileged={row.reactivate.privileged}
        labels={props.reactivateLabels}
        errors={props.errors}
        openProfile={{ label: text('openProfile'), href: row.profileHref }}
        compact
      />
    ) : null;

  const nameButton = (row: MemberRowView, place: Place) => (
    <button
      type="button"
      id={`member-name-${place}-${row.personId}`}
      onClick={() => {
        setPeek({ row, returnId: `member-name-${place}-${row.personId}` });
      }}
      aria-haspopup="dialog"
      className="text-start font-semibold text-text hover:underline"
      data-testid="member-peek"
    >
      {row.name}
    </button>
  );

  const withActions = rows.some((r) => r.reactivate !== null);
  const roleTarget: RoleTarget | null = roleFor?.row.role
    ? { personId: roleFor.row.personId, name: roleFor.row.name, ...roleFor.row.role }
    : null;

  return (
    <>
      <div className="hidden md:block">
        <div className={tableClasses.wrapper}>
          <table className={tableClasses.table} data-testid="users-table">
            <caption className="sr-only">{text('tableCaption')}</caption>
            <thead className={tableClasses.header}>
              <tr>
                <th scope="col" className={tableClasses.head}>
                  {text('columns.name')}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {text('columns.employeeNumber')}
                </th>
                {props.showRole ? (
                  <th scope="col" className={tableClasses.head}>
                    {text('columns.primaryRole')}
                  </th>
                ) : null}
                <th scope="col" className={tableClasses.head} data-testid="users-unit-column">
                  {props.unitHeader}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {text('columns.status')}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {text('columns.lastSignIn')}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {withActions ? (
                    text('columns.actions')
                  ) : (
                    <span className="sr-only">{text('columns.actions')}</span>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.personId}
                  className={`${tableClasses.row} ${peek?.row.personId === row.personId || roleFor?.row.personId === row.personId ? 'bg-surface-selected' : ''}`}
                >
                  <td className={tableClasses.cell}>
                    <div className="flex items-center gap-3">
                      <Avatar name={row.name} tone="soft" size="md" />
                      <div className="min-w-0">
                        {nameButton(row, 'table')}
                        {row.email ? (
                          <div className="text-sm text-text-muted">
                            <bdi dir="ltr">{row.email}</bdi>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className={tableClasses.cell}>
                    {row.employeeNumber ? (
                      <bdi dir="ltr">{row.employeeNumber}</bdi>
                    ) : (
                      <span className="italic text-text-muted">{text('noneLabel')}</span>
                    )}
                  </td>
                  {props.showRole ? <td className={tableClasses.cell}>{role(row)}</td> : null}
                  <td className={tableClasses.cell}>
                    {row.unitName ?? (
                      <span className="italic text-text-muted">{text('noneLabel')}</span>
                    )}
                  </td>
                  <td className={tableClasses.cell}>{status(row)}</td>
                  <td className={tableClasses.cell} data-testid="user-last-sign-in">
                    {row.lastSignIn}
                  </td>
                  <td className={`${tableClasses.cell} text-end`}>
                    {reactivate(row) ?? menu(row, 'table')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ListCards data-testid="users-cards">
        {rows.map((row) => (
          <ListCard
            key={row.personId}
            leading={<Avatar name={row.name} tone="soft" size="md" />}
            title={nameButton(row, 'card')}
            detail={[row.roleName, row.unitName].filter(Boolean).join(' · ') || null}
            status={
              <span className="flex flex-wrap items-center gap-2.5 text-[13px] text-text-muted">
                {status(row)}
                {row.employeeNumber ? <bdi dir="ltr">{row.employeeNumber}</bdi> : null}
                <span data-testid="user-last-sign-in">{row.lastSignIn}</span>
              </span>
            }
            action={reactivate(row) ?? menu(row, 'card')}
          />
        ))}
      </ListCards>

      {peek ? (
        <PeekPanel
          row={peek.row}
          showRole={props.showRole}
          unitHeader={props.unitHeader}
          text={text}
          onClose={() => {
            returnFocusTo(peek.returnId);
            setPeek(null);
          }}
          onChangeRole={
            props.roleMenu && peek.row.role
              ? () => {
                  // The role panel replaces the quick look; closing it returns to the person's name.
                  setRoleFor(peek);
                  setPeek(null);
                }
              : null
          }
          status={status(peek.row)}
          role={role(peek.row)}
        />
      ) : null}

      {props.roleMenu && roleTarget ? (
        <ChangeRolePanel
          // A new panel per person: its choice starts from that person's role.
          key={roleTarget.personId}
          open
          onClose={() => {
            if (roleFor) returnFocusTo(roleFor.returnId);
            setRoleFor(null);
          }}
          target={roleTarget}
          options={props.roleMenu.options}
          selectTexts={props.roleMenu.selectTexts}
          scopeUnits={props.roleMenu.scopeUnits}
          unitTexts={props.roleMenu.unitTexts}
          labels={props.roleMenu.labels}
          errors={props.errors}
          undoLabel={text('undo')}
          locale={props.locale}
        />
      ) : null}
    </>
  );
}

/** The quick look at one person (Plain's peek): facts with copy buttons, and the next steps. */
function PeekPanel({
  row,
  showRole,
  unitHeader,
  text,
  onClose,
  onChangeRole,
  status,
  role,
}: {
  readonly row: MemberRowView;
  readonly showRole: boolean;
  readonly unitHeader: string;
  readonly text: (key: string, values?: Record<string, string>) => string;
  readonly onClose: () => void;
  readonly onChangeRole: (() => void) | null;
  readonly status: ReactNode;
  readonly role: ReactNode;
}) {
  const copy = (field: string, value: string) => (
    <CopyButton
      value={value}
      label={text('copyField', { field })}
      copiedText={text('copied', { field })}
      failedText={text('copyFailed')}
    />
  );
  const facts: { key: string; label: string; value: ReactNode }[] = [
    {
      key: 'email',
      label: text('fields.email'),
      value: row.email ? (
        <span className="flex items-center justify-between gap-2">
          <bdi dir="ltr" className="min-w-0 [overflow-wrap:anywhere]">
            {row.email}
          </bdi>
          {copy(text('fields.email'), row.email)}
        </span>
      ) : (
        <span className="italic text-text-muted">{text('noneLabel')}</span>
      ),
    },
    {
      key: 'employeeNumber',
      label: text('columns.employeeNumber'),
      value: row.employeeNumber ? (
        <span className="flex items-center gap-2">
          <bdi dir="ltr">{row.employeeNumber}</bdi>
          {copy(text('columns.employeeNumber'), row.employeeNumber)}
        </span>
      ) : (
        <span className="italic text-text-muted">{text('noneLabel')}</span>
      ),
    },
    ...(showRole ? [{ key: 'role', label: text('columns.primaryRole'), value: role }] : []),
    {
      key: 'unit',
      label: unitHeader,
      value: row.unitName ?? <span className="italic text-text-muted">{text('noneLabel')}</span>,
    },
    { key: 'status', label: text('columns.status'), value: status },
    { key: 'lastSignIn', label: text('columns.lastSignIn'), value: row.lastSignIn },
  ];
  return (
    <SidePanel
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          <Avatar name={row.name} size="md" />
          <span>{row.name}</span>
        </span>
      }
      description={[row.roleName, row.unitName].filter(Boolean).join(' · ') || undefined}
      closeLabel={text('close')}
      data-testid="member-peek-panel"
      footer={
        <>
          <Link
            href={row.profileHref}
            className={buttonClasses({ variant: 'primary', size: 'md' })}
            data-testid="peek-open-profile"
          >
            {text('openProfile')}
            <Icon name="arrow-end" />
          </Link>
          {onChangeRole ? (
            <button
              type="button"
              className={buttonClasses({ variant: 'secondary', size: 'md' })}
              onClick={onChangeRole}
              data-testid="peek-change-role"
            >
              <Icon name="key" />
              {text('changeRole')}
            </button>
          ) : null}
        </>
      }
    >
      <dl className="m-0 flex flex-col">
        {facts.map((fact) => (
          <div
            key={fact.key}
            className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 border-b border-border py-3"
          >
            <dt className="text-sm text-text-muted">{fact.label}</dt>
            <dd className="m-0 font-medium">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </SidePanel>
  );
}
