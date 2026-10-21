'use client';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChecklistAccordion,
  ChoiceCard,
  Icon,
  ListSearch,
  SaveBar,
  TextField,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from 'react';
import { createCustomRoleAction, updateCustomRoleAction } from '../../actions/roles';
import { fillText } from '../../lib/fill-text';
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
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { DiscardDialog } from '../users/person-panels';
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
  /** The roles list: where «Cancel» and a save lead (a toast says it was saved). */
  readonly rolesHref: string;
  /** The page's language (numbers in the count badges). */
  readonly locale: 'ar' | 'en';
  /** Editing: «N people hold this role» (formatted on the server), shown with the privileged notice. */
  readonly holdersText?: string;
}

type FieldErrors = Partial<Record<keyof BuilderValues, string>>;

const FORM_ID = 'role-builder';

function sameValues(a: BuilderValues, b: BuilderValues): boolean {
  return (
    a.nameEn === b.nameEn &&
    a.nameAr === b.nameAr &&
    a.description === b.description &&
    a.dataScope === b.dataScope &&
    a.permissions.length === b.permissions.length &&
    a.permissions.every((code, index) => b.permissions[index] === code)
  );
}

/**
 * Create or edit a custom role (FR-IAM-07; EP-ROLES; redesign package 3 — Shopify's role editor, Employment
 * Hero, Clerk's unsaved bar): names, description and «start from»; the data the role sees as cards; the
 * permissions by module with a search; a sticky summary (what it sees, how many permissions, high-risk ones,
 * the privileged notice, its holders). The save bar appears once something changed; leaving with unsaved
 * changes asks first. When a narrower scope clears administrative permissions, the notice offers «Undo»
 * (the ticks come back with the scope). Same rules as before — administrative permissions need the whole
 * organization; a high-risk or user / role management permission makes the role privileged; the action and
 * the database check everything again. Notices are announced through one live region (WCAG 4.1.3).
 */
export function RoleBuilderForm(props: RoleBuilderFormProps) {
  const { groups, texts } = props;
  const text = (key: string) => texts[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<BuilderValues>(props.initial);
  const [saved, setSaved] = useState<BuilderValues>(props.initial);
  const [start, setStart] = useState(props.initialStart ?? '');
  // The scope and ticks before a narrower scope cleared administrative permissions (for «Undo»).
  const [cleared, setCleared] = useState<{
    readonly scope: BuilderScope;
    readonly permissions: readonly string[];
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [leaving, setLeaving] = useState<string | null>(null);
  const privileged = builderIsPrivileged(groups, values.permissions);
  const chosen = new Set(values.permissions);
  const dirty = !sameValues(values, saved);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty && !pending;
  }, [dirty, pending]);

  // Leaving with unsaved changes asks first: links inside the app (Discard your changes?), and the browser's
  // own reload or close.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank') return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving(url.pathname + url.search + url.hash);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

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
    setCleared(null);
    setFieldErrors({});
  }

  function onScope(scope: BuilderScope) {
    const next = changeScope(groups, values.permissions, scope);
    setCleared(
      next.cleared ? { scope: values.dataScope, permissions: [...values.permissions] } : null,
    );
    update({ dataScope: scope, permissions: next.permissions });
  }

  function undoScope() {
    if (!cleared) return;
    update({ dataScope: cleared.scope, permissions: cleared.permissions });
    setCleared(null);
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
        setSaved(values);
        dirtyRef.current = false;
        toast.success(text('saved'));
        router.push(props.rolesHref);
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
          // Counts (e.g. who still holds the role with a unit, C-M1) fill the message's placeholders.
          if (mapped) {
            next[mapped.field] ??= fillText(
              text(`fieldErrors.${mapped.key}`),
              Object.fromEntries(
                Object.entries(result.error.params ?? {}).map(([k, v]) => [
                  k,
                  typeof v === 'boolean' ? String(v) : v,
                ]),
              ),
              props.locale,
            );
          }
        }
        setFieldErrors(next);
      }
      setMessage(errorText(result.error, props.errors));
    });
  }

  const needle = query.trim().toLocaleLowerCase();
  const accordionGroups = groups
    .map((group) => ({
      key: group.key,
      title: group.title,
      items: group.permissions
        .filter(
          (permission) =>
            needle === '' ||
            `${permission.label} ${permission.description}`.toLocaleLowerCase().includes(needle),
        )
        .map((permission) => {
          const checked = chosen.has(permission.code);
          const block = permissionBlock(permission, values.dataScope, checked);
          return {
            value: permission.code,
            label: permission.label,
            description: permission.description,
            badge: permission.highRisk ? (
              <Badge tone="warning">{text('highRisk')}</Badge>
            ) : undefined,
            checked,
            disabled: pending || block !== null,
            note: block ? text(block) : undefined,
          };
        }),
    }))
    .filter((group) => group.items.length > 0);

  const all = groups.flatMap((g) => g.permissions);
  const highRisk = all.filter((p) => p.highRisk && chosen.has(p.code)).length;
  const count = (template: string, checked: number, total: number) =>
    fillText(template, { checked, total }, props.locale);

  const startGroups = (['blank', 'standard', 'template'] as const).map((group) => ({
    group,
    starts: props.starts.filter((s) => s.group === group),
  }));

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form
          id={FORM_ID}
          className="flex min-w-0 flex-col gap-5"
          onSubmit={onSubmit}
          onReset={(event) => {
            // The save bar's Cancel: back to the last saved values (not the browser's reset).
            event.preventDefault();
            setValues(saved);
            setCleared(null);
            setFieldErrors({});
            setMessage(null);
          }}
          noValidate
          data-testid="role-builder"
        >
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
            <div className="flex flex-col gap-3">
              {/* One polite live region, always mounted: what changed is announced once (WCAG 4.1.3). */}
              <p
                className="sr-only"
                role="status"
                aria-live="polite"
                data-testid="role-builder-announcer"
              >
                {[cleared ? text('scopeCleared') : '', privileged ? text('privilegedNotice') : '']
                  .filter(Boolean)
                  .join(' ')}
              </p>
              {cleared ? (
                <Alert
                  tone="warning"
                  role="note"
                  data-testid="role-scope-cleared"
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={undoScope}
                      data-testid="role-scope-undo"
                    >
                      <Icon name="undo" className="size-4" />
                      {text('undo')}
                    </Button>
                  }
                >
                  {text('scopeCleared')}
                </Alert>
              ) : null}
              <fieldset
                className="m-0 grid grid-cols-1 gap-3 border-0 p-0 md:grid-cols-2"
                aria-describedby={fieldErrors.dataScope ? 'role-scope-error' : undefined}
              >
                <legend className="sr-only">{text('dataScope')}</legend>
                {BUILDER_SCOPES.map((scope) => (
                  <ChoiceCard
                    key={scope}
                    id={`role-scope-${scope}`}
                    name="dataScope"
                    value={scope}
                    checked={values.dataScope === scope}
                    onChange={() => {
                      onScope(scope);
                    }}
                    disabled={pending}
                    title={text(`scopes.${scope}.label`)}
                    description={text(`scopes.${scope}.hint`)}
                    data-testid={`role-scope-card-${scope}`}
                  />
                ))}
              </fieldset>
              {fieldErrors.dataScope ? (
                <p id="role-scope-error" className="m-0 text-sm font-medium text-danger">
                  {fieldErrors.dataScope}
                </p>
              ) : null}
            </div>
          </Card>

          <Card
            title={text('permissions')}
            actions={
              <Badge tone="neutral">
                {count(text('countLabel'), values.permissions.length, all.length)}
              </Badge>
            }
          >
            <div className="flex flex-col gap-3">
              <p className="m-0 text-sm text-text-muted">{text('permissionsHint')}</p>
              <ListSearch
                id="role-permission-search"
                label={text('searchPermissions')}
                placeholder={text('searchPermissions')}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
              {accordionGroups.length === 0 ? (
                <p role="status" className="m-0 text-text-muted">
                  {text('noMatches')}
                </p>
              ) : (
                <ChecklistAccordion
                  // A new search shows its groups open.
                  key={needle}
                  groups={accordionGroups}
                  onToggle={(code, on) => {
                    update({ permissions: togglePermission(groups, values.permissions, code, on) });
                  }}
                  countLabel={(checked, total) => count(text('countLabel'), checked, total)}
                  idPrefix="role-permission"
                  defaultOpen="all"
                  data-testid="role-permissions"
                />
              )}
              {fieldErrors.permissions ? (
                <p className="m-0 text-sm font-medium text-danger" role="alert">
                  {fieldErrors.permissions}
                </p>
              ) : null}
            </div>
          </Card>

          {message ? (
            <Alert tone="danger" data-testid="role-builder-message">
              {message}
            </Alert>
          ) : null}
        </form>

        <aside className="lg:sticky lg:top-24" aria-labelledby="role-summary-heading">
          <Card>
            <h2 id="role-summary-heading" className="m-0 mb-3 text-lg font-bold">
              {text('summary')}
            </h2>
            <dl className="m-0 flex flex-col text-sm" data-testid="role-summary">
              <div className="flex justify-between gap-3 border-b border-border py-2.5">
                <dt className="text-text-muted">{text('summarySees')}</dt>
                <dd className="m-0 text-end font-semibold">
                  {text(`scopes.${values.dataScope}.label`)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-border py-2.5">
                <dt className="text-text-muted">{text('permissions')}</dt>
                <dd className="m-0 text-end font-semibold">
                  {count(text('countLabel'), values.permissions.length, all.length)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="text-text-muted">{text('highRisk')}</dt>
                <dd className="m-0 text-end font-semibold">
                  {text(`highRiskCount.${String(highRisk)}`)}
                </dd>
              </div>
            </dl>
            {privileged ? (
              <Alert
                tone="warning"
                role="note"
                className="mt-3"
                data-testid="role-privileged-notice"
              >
                {text('privilegedNotice')}
                {props.holdersText ? (
                  <span className="mt-1 block font-medium" data-testid="role-holders">
                    {props.holdersText}
                  </span>
                ) : null}
              </Alert>
            ) : props.holdersText ? (
              <p className="m-0 mt-3 text-sm font-medium" data-testid="role-holders">
                {props.holdersText}
              </p>
            ) : null}
            <p className="m-0 mt-3 flex gap-2 text-sm text-text-muted">
              <Icon name="shield" className="mt-0.5 size-4 shrink-0" />
              {text('audited')}
            </p>
          </Card>
        </aside>
      </div>

      {dirty || pending ? (
        <SaveBar
          state={pending ? 'saving' : 'unsaved'}
          form={FORM_ID}
          texts={{
            unsaved: text('unsaved'),
            saving: text('saving'),
            saved: '',
            save: text('save'),
            cancel: text('cancel'),
          }}
        />
      ) : (
        <div className="mt-6 flex justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              router.push(props.rolesHref);
            }}
          >
            {text('cancel')}
          </Button>
        </div>
      )}

      <DiscardDialog
        open={leaving !== null}
        texts={{
          title: text('discardTitle'),
          body: text('discardBody'),
          keepEditing: text('keepEditing'),
          discard: text('discard'),
        }}
        onKeep={() => {
          setLeaving(null);
        }}
        onDiscard={() => {
          const href = leaving;
          setLeaving(null);
          dirtyRef.current = false;
          if (href) router.push(href);
        }}
      />
    </>
  );
}
