'use client';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChecklistAccordion,
  TextField,
  buttonClasses,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { createCustomRoleAction, updateCustomRoleAction } from '../../actions/roles';
import {
  BUILDER_SCOPES,
  type BuilderGroup,
  type BuilderScope,
  type BuilderStart,
  type BuilderValues,
  applyStart,
  builderFieldError,
  builderIsPrivileged,
  changeScope,
  permissionBlock,
  togglePermission,
} from '../../lib/role-builder';
import { fillText } from '../../lib/fill-text';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';

export interface RoleBuilderFormProps {
  /** Edit an existing custom role (its id and version), or create one. */
  readonly editing: { readonly id: string; readonly version: number } | null;
  readonly initial: BuilderValues;
  readonly groups: readonly BuilderGroup[];
  /** «Start from» choices (create only; empty when editing). */
  readonly starts: readonly BuilderStart[];
  /** The start already applied to `initial` («create a role from it»), or ''. */
  readonly initialStart?: string;
  /** Texts by key (namespace `roleBuilder`, translated on the server; `scopes.<s>.label|hint`). */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** The roles list: «Cancel» and where to go after saving. */
  readonly rolesHref: string;
  readonly savedHref: string;
  /** The page's language (numbers in the count badges). */
  readonly locale: 'ar' | 'en';
}

type FieldErrors = Partial<Record<keyof BuilderValues, string>>;

/**
 * Create or edit a custom role (FR-IAM-07; EP-ROLES, PO 17 Oct 2026 — Kawadir's roles screen with its
 * permissions accordion): names in English and Arabic, description, «start from» (blank, a standard role
 * or a template), the permissions grouped by module with a «ticked / total» badge and «High risk» badges,
 * and the data the role sees. Only permissions the Organization Admin holds can be ticked; administrative
 * permissions need the whole organization. A role with a high-risk permission is privileged.
 */
export function RoleBuilderForm(props: RoleBuilderFormProps) {
  const { groups, texts } = props;
  const text = (key: string) => texts[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<BuilderValues>(props.initial);
  const [start, setStart] = useState(props.initialStart ?? '');
  const [cleared, setCleared] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const privileged = builderIsPrivileged(groups, values.permissions);
  const chosen = new Set(values.permissions);

  function update(next: Partial<BuilderValues>) {
    setValues((current) => ({ ...current, ...next }));
    setFieldErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !(key in next))),
    );
  }

  function onStart(value: string) {
    setStart(value);
    const choice = props.starts.find((s) => s.value === value);
    if (!choice) return;
    setValues((current) => applyStart(groups, current, choice));
    setCleared(false);
    setFieldErrors({});
  }

  function onScope(scope: BuilderScope) {
    const next = changeScope(groups, values.permissions, scope);
    setCleared(next.cleared);
    update({ dataScope: scope, permissions: next.permissions });
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const missing: FieldErrors = {};
    if (values.nameEn.trim() === '') missing.nameEn = text('fieldErrors.required');
    if (values.nameAr.trim() === '') missing.nameAr = text('fieldErrors.required');
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      return;
    }
    const input = {
      nameEn: values.nameEn,
      nameAr: values.nameAr,
      description: values.description,
      dataScope: values.dataScope,
      permissions: [...values.permissions],
    };
    startTransition(async () => {
      const result = props.editing
        ? await updateCustomRoleAction({
            ...input,
            id: props.editing.id,
            version: props.editing.version,
          })
        : await createCustomRoleAction(input);
      if (result.ok) {
        router.push(props.savedHref);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      if (result.error.code === 'CONFLICT_VERSION') {
        setMessage(text('conflict'));
        return;
      }
      if (result.error.code === 'NOT_FOUND') {
        setMessage(text('notFound'));
        return;
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        const next: FieldErrors = {};
        for (const fieldError of result.error.fieldErrors ?? []) {
          const mapped = builderFieldError(fieldError.path, fieldError.code);
          if (mapped) next[mapped.field] ??= text(`fieldErrors.${mapped.key}`);
        }
        setFieldErrors(next);
      }
      setMessage(errorText(result.error, props.errors));
    });
  }

  const accordionGroups = groups.map((group) => ({
    key: group.key,
    title: group.title,
    items: group.permissions.map((permission) => {
      const checked = chosen.has(permission.code);
      const block = permissionBlock(permission, values.dataScope, checked);
      return {
        value: permission.code,
        label: permission.label,
        description: permission.description,
        badge: permission.highRisk ? <Badge tone="warning">{text('highRisk')}</Badge> : undefined,
        checked,
        disabled: pending || block !== null,
        note: block ? text(block) : undefined,
      };
    }),
  }));

  const startGroups = (['blank', 'standard', 'template'] as const).map((group) => ({
    group,
    starts: props.starts.filter((s) => s.group === group),
  }));

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit} noValidate data-testid="role-builder">
      <Card title={text('details')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {props.starts.length > 0 ? (
            <div className="sm:col-span-2">
              <SelectField
                id="role-start"
                label={text('startFrom')}
                hint={text('startHint')}
                value={start}
                onChange={(event) => {
                  onStart(event.target.value);
                }}
                disabled={pending}
                data-testid="role-start"
              >
                <option value="" disabled>
                  {text('startPlaceholder')}
                </option>
                {startGroups.map(({ group, starts }) =>
                  group === 'blank' ? (
                    starts.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))
                  ) : starts.length > 0 ? (
                    <optgroup
                      key={group}
                      label={text(group === 'standard' ? 'startStandard' : 'startTemplate')}
                    >
                      {starts.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null,
                )}
              </SelectField>
            </div>
          ) : null}
          <TextField
            id="role-name-en"
            label={text('nameEn')}
            marker={text('required')}
            hint={text('nameHint')}
            value={values.nameEn}
            onChange={(event) => {
              update({ nameEn: event.target.value });
            }}
            maxLength={80}
            required
            dir="ltr"
            lang="en"
            autoComplete="off"
            error={fieldErrors.nameEn}
            disabled={pending}
          />
          <TextField
            id="role-name-ar"
            label={text('nameAr')}
            marker={text('required')}
            hint={text('nameHint')}
            value={values.nameAr}
            onChange={(event) => {
              update({ nameAr: event.target.value });
            }}
            maxLength={80}
            required
            dir="rtl"
            lang="ar"
            autoComplete="off"
            error={fieldErrors.nameAr}
            disabled={pending}
          />
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="role-description" className="text-sm font-medium">
              {text('description')}
              <span className="ms-1 font-normal text-text-muted">{text('optional')}</span>
            </label>
            <p id="role-description-hint" className="m-0 text-sm text-text-muted">
              {text('descriptionHint')}
            </p>
            <textarea
              id="role-description"
              value={values.description}
              onChange={(event) => {
                update({ description: event.target.value });
              }}
              maxLength={500}
              rows={3}
              aria-describedby={
                fieldErrors.description
                  ? 'role-description-hint role-description-error'
                  : 'role-description-hint'
              }
              aria-invalid={fieldErrors.description ? true : undefined}
              disabled={pending}
              className={`w-full rounded-2xl border bg-surface px-4 py-2 text-sm text-text shadow-1 disabled:cursor-not-allowed disabled:bg-surface-sunken ${
                fieldErrors.description ? 'border-danger' : 'border-border-strong'
              }`}
            />
            {fieldErrors.description ? (
              <p id="role-description-error" className="m-0 text-sm font-medium text-danger">
                {fieldErrors.description}
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <Card title={text('dataScope')}>
        <fieldset
          className="m-0 grid grid-cols-1 gap-3 border-0 p-0 md:grid-cols-2"
          aria-describedby={fieldErrors.dataScope ? 'role-scope-error' : undefined}
        >
          <legend className="sr-only">{text('dataScope')}</legend>
          {BUILDER_SCOPES.map((scope) => (
            <div
              key={scope}
              className={`flex min-h-11 items-start gap-3 rounded-xl border p-3 ${
                values.dataScope === scope ? 'border-primary bg-primary-subtle' : 'border-border'
              }`}
            >
              <input
                id={`role-scope-${scope}`}
                type="radio"
                name="dataScope"
                value={scope}
                checked={values.dataScope === scope}
                onChange={() => {
                  onScope(scope);
                }}
                disabled={pending}
                aria-describedby={`role-scope-${scope}-hint`}
                className="mt-0.5 size-5 shrink-0 accent-primary"
                data-testid={`role-scope-${scope}`}
              />
              <div className="flex flex-col gap-0.5">
                <label htmlFor={`role-scope-${scope}`} className="text-sm font-medium">
                  {text(`scopes.${scope}.label`)}
                </label>
                <p id={`role-scope-${scope}-hint`} className="m-0 text-sm text-text-muted">
                  {text(`scopes.${scope}.hint`)}
                </p>
              </div>
            </div>
          ))}
        </fieldset>
        {fieldErrors.dataScope ? (
          <p id="role-scope-error" className="mb-0 mt-2 text-sm font-medium text-danger">
            {fieldErrors.dataScope}
          </p>
        ) : null}
      </Card>

      <Card title={text('permissions')}>
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm text-text-muted">{text('permissionsHint')}</p>
          {cleared ? (
            <Alert tone="info" data-testid="role-scope-cleared">
              {text('scopeCleared')}
            </Alert>
          ) : null}
          {privileged ? (
            <Alert tone="warning" data-testid="role-privileged-notice">
              {text('privilegedNotice')}
            </Alert>
          ) : null}
          <ChecklistAccordion
            groups={accordionGroups}
            onToggle={(code, on) => {
              update({ permissions: togglePermission(groups, values.permissions, code, on) });
            }}
            countLabel={(checked, total) =>
              fillText(text('countLabel'), { checked, total }, props.locale)
            }
            idPrefix="role-permission"
            defaultOpen="all"
            data-testid="role-permissions"
          />
          {fieldErrors.permissions ? (
            <p className="m-0 text-sm font-medium text-danger" role="alert">
              {fieldErrors.permissions}
            </p>
          ) : null}
        </div>
      </Card>

      <p className="m-0 text-sm text-text-muted">{text('audited')}</p>
      {message ? (
        <Alert tone="danger" data-testid="role-builder-message">
          {message}
        </Alert>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <a href={props.rolesHref} className={buttonClasses({ variant: 'secondary', size: 'md' })}>
          {text('cancel')}
        </a>
        <Button type="submit" disabled={pending} data-testid="role-save">
          {pending ? text('saving') : text('save')}
        </Button>
      </div>
    </form>
  );
}
