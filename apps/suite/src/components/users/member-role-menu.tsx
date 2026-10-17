'use client';
import {
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
} from '@jadarat/ui';
import { useState } from 'react';
import type { RoleOption } from '../../lib/role-choice';
import type { ErrorTexts } from '../auth/error-text';
import { EditRoleForm } from './edit-role-form';
import type { RoleSelectTexts } from './role-select';

export interface MemberRoleMenuProps {
  readonly personId: string;
  readonly name: string;
  readonly version: string;
  readonly currentRole: string | null;
  readonly options: readonly RoleOption[];
  readonly selectTexts: RoleSelectTexts;
  /** Texts by key: `actionsFor` (with {name}), `editRole`, `dialogTitle`, `dialogDescription` (with
   * {name}), `close` and the edit-role form's keys. */
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/**
 * The ⋯ menu of a member row on Team members (Kawadir team page): «تعديل الدور» opens the edit-role dialog
 * (one role per person, EP-ROLES). Shown only for members the signed-in member may manage.
 */
export function MemberRoleMenu(props: MemberRoleMenuProps) {
  const [open, setOpen] = useState(false);
  const text = (key: string) => props.labels[key] ?? key;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
          aria-label={text('actionsFor').split('{name}').join(props.name)}
          data-testid={`member-menu-${props.personId}`}
        >
          <Icon name="more" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={() => {
              setOpen(true);
            }}
            data-testid="member-menu-edit-role"
          >
            <Icon name="shield" />
            {text('editRole')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={text('dialogTitle')}
        description={text('dialogDescription').split('{name}').join(props.name)}
        closeLabel={text('close')}
        data-testid="edit-role-dialog"
      >
        {open ? (
          <EditRoleForm
            personId={props.personId}
            version={props.version}
            currentRole={props.currentRole}
            options={props.options}
            selectTexts={props.selectTexts}
            labels={props.labels}
            errors={props.errors}
            idPrefix={`edit-role-${props.personId}`}
            onCancel={() => {
              setOpen(false);
            }}
            onSaved={() => {
              setOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
