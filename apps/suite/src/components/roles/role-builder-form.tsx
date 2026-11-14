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
  TabNav,
  TextField,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { updateCustomRoleAction } from '../../actions/roles';
import { fillText } from '../../lib/fill-text';
import {
  BUILDER_SCOPES,
  type BuilderGroup,
  type BuilderScope,
  type BuilderValues,
  builderFieldError,
  builderIsPrivileged,
  changeScope,
  ROLE_EDIT_TABS,
  type RoleEditTab,
  permissionBlock,
  roleEditTab,
  roleEditTabOf,
  togglePermission,
} from '../../lib/role-builder';
import { nameOrder } from '../../lib/structure-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { LoadLatestVersion, useLatestVersion } from '../latest-version';
import { DiscardDialog } from '../users/discard-dialog';

export interface RoleBuilderFormProps {
  /** The custom role (its id and version): a role is created in the «Create role» popup first. */
  readonly editing: { readonly id: string; readonly version: number };
  readonly initial: BuilderValues;
  readonly groups: readonly BuilderGroup[];
  /** The language whose name is required: the organization's default language (PO, 12 Nov 2026). */
  readonly nameLanguage: 'ar' | 'en';
  /** Texts by key (namespace `roleBuilder`, translated on the server; `scopes.<s>.label|hint`). */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** The roles list: where «Cancel» and a save lead (a toast says it was saved). */
  readonly rolesHref: string;
  /** The page's language (numbers in the count badges). */
  readonly locale: 'ar' | 'en';
  /** Editing: «N people hold this role» (formatted on the server), shown with the privileged notice. */
  readonly holdersText?: string;
  /** The section open first (`?tab=`): «Name and scope», «Permissions» or «Who holds it». */
  readonly tab: RoleEditTab;
  /** The role page's address (locale included), without `?tab=`. */
  readonly roleHref: string;
  /** «Who holds it»: what the server says about deleting the role (in use, or «Delete role»). */
  readonly holders: ReactNode;
}

const TAB_ICON = { details: 'pencil', permissions: 'key', holders: 'people' } as const;

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
 * A custom role's own page — the builder (FR-IAM-07; EP-ROLES; redesign package 3 — Shopify's role editor,
 * Employment Hero, Clerk's unsaved bar). A role is created in the «Create role» popup (start from + names;
 * the Kawadir pattern, WP-UX-01 c) and opens here, its sections as tabs at the side (WP-UX-01 e, T-M3-21),
 * each its own address (`?tab=`): «Name and scope» — its name in the organization's default language (the
 * other language optional), its description and the data the role sees as cards; «Permissions» — by module,
 * with a search; «Who holds it» — the summary (what it sees, how many permissions, high-risk ones), its
 * holders and «Delete role». The sections are one form: moving between them keeps what was changed (a
 * narrower scope clears permissions on the other tab), and one save bar saves the role once something
 * changed; a refused field opens its section. The privileged notice stays above every section. Leaving the
 * page with unsaved changes asks first. When a narrower scope clears administrative permissions, the notice offers «Undo»
 * (the ticks come back with the scope). Same rules as before — administrative permissions need the whole
 * organization; a high-risk or user / role management permission makes the role privileged; the action and
 * the database check everything again. Notices are announced through one live region (WCAG 4.1.3).
 */
export function RoleBuilderForm(props: RoleBuilderFormProps) {
  const { groups, texts } = props;
  const text = (key: string) => texts[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const latestVersion = useLatestVersion();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<BuilderValues>(props.initial);
  const [saved, setSaved] = useState<BuilderValues>(props.initial);
  // The scope and ticks before a narrower scope cleared administrative permissions (for «Undo»).
  const [cleared, setCleared] = useState<{
    readonly scope: BuilderScope;
    readonly permissions: readonly string[];
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [leaving, setLeaving] = useState<string | null>(null);
  const [tab, setTab] = useState<RoleEditTab>(props.tab);
  /** The open section's cards (its first heading takes the focus when the section is opened). */
  const sectionRef = useRef<HTMLDivElement>(null);
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
      // The same page (another of its sections): the tabs keep the changes, nothing to ask.
      if (url.pathname === window.location.pathname) return;
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

  /** Opens a section: the same form, so nothing typed is lost; the address says which one is open. */
  function openTab(next: RoleEditTab) {
    setTab(next);
    const href = next === 'details' ? props.roleHref : `${props.roleHref}?tab=${next}`;
    window.history.replaceState(window.history.state, '', href);
  }

  /** A click on a section's link switches in place (a modified click opens it as a link). */
  function onTabClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const anchor = (event.target as Element | null)?.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const next = roleEditTab(new URL(anchor.href, window.location.href).searchParams.get('tab'));
    event.preventDefault();
    openTab(next);
    // A screen reader hears the change: the shown section's heading takes the focus.
    window.setTimeout(() => {
      const heading = sectionRef.current?.querySelector<HTMLElement>('h2');
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus();
    }, 0);
  }

  function update(next: Partial<BuilderValues>) {
    setValues((current) => ({ ...current, ...next }));
    setFieldErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !(key in next))),
    );
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
    // The name in the organization's default language is required, the other one optional. Names left as
    // they are stored pass (a role named before the organization changed its default language).
    const requiredName = props.nameLanguage === 'ar' ? 'nameAr' : 'nameEn';
    const namesUntouched =
      values.nameEn.trim() === props.initial.nameEn &&
      values.nameAr.trim() === props.initial.nameAr;
    if (values[requiredName].trim() === '' && !namesUntouched) {
      missing[requiredName] = text('fieldErrors.required');
    }
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      openTab('details');
      focusFirstInvalid();
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
      const result = await updateCustomRoleAction({
        ...input,
        id: props.editing.id,
        version: props.editing.version,
      });
      if (result.ok) {
        setSaved(values);
        dirtyRef.current = false;
        toast.success(text('saved'));
        router.push(props.rolesHref);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      // An older copy of the role (WP-FIX-03): what was chosen stays; «Load the latest version» is offered.
      const latest = latestVersion.offer(result.error, text('conflict'));
      if (latest !== null) {
        setMessage(latest);
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
        // The refused field's section opens, and the focus goes to the field.
        const first = (Object.keys(next) as (keyof BuilderValues)[])[0];
        if (first) openTab(roleEditTabOf(first));
        focusFirstInvalid();
      }
      setMessage(errorText(result.error, props.errors));
    });
  }

  /** After a refusal: the first field with a message takes the focus once its section is shown. */
  function focusFirstInvalid() {
    window.setTimeout(() => {
      document
        .getElementById(FORM_ID)
        ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-refusal]')
        ?.focus();
    }, 0);
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

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[230px_minmax(0,1fr)] xl:gap-6">
        {/* The section links switch in place (one form, nothing typed is lost); each keeps its address. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegates the clicks of the links inside, which keep their own keyboard behaviour */}
        <div onClick={onTabClick} className="min-w-0 xl:sticky xl:top-24">
          <TabNav
            variant="side"
            label={text('tabsLabel')}
            current={tab}
            items={ROLE_EDIT_TABS.map((key) => ({
              key,
              href: key === 'details' ? props.roleHref : `${props.roleHref}?tab=${key}`,
              label: text(`tabs.${key}`),
              icon: TAB_ICON[key],
              ...(key === 'permissions' ? { count: values.permissions.length } : {}),
            }))}
            data-testid="role-tabs"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
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
            data-tab={tab}
          >
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
            {privileged ? (
              <Alert tone="warning" role="note" data-testid="role-privileged-notice">
                {text('privilegedNotice')}
                {props.holdersText ? (
                  <span className="mt-1 block font-medium" data-testid="role-holders">
                    {props.holdersText}
                  </span>
                ) : null}
              </Alert>
            ) : null}
            <div ref={sectionRef} className="flex min-w-0 flex-col gap-5">
              {tab === 'details' ? (
                <>
                  <Card title={text('details')}>
                    <div className="grid grid-cols-1 gap-4">
                      {/* The organization's default language first (required), then the other one (optional). */}
                      {nameOrder(props.nameLanguage).map((language) => {
                        const field = language === 'ar' ? 'nameAr' : 'nameEn';
                        // A role named before the rule may have no name in today's default language: the
                        // asterisk shows where a name is asked now (a changed name, or one that is stored).
                        const required =
                          language === props.nameLanguage &&
                          (props.initial[field] !== '' ||
                            values.nameEn !== props.initial.nameEn ||
                            values.nameAr !== props.initial.nameAr);
                        return (
                          <TextField
                            key={field}
                            id={`role-name-${language}`}
                            label={text(field)}
                            marker={text(required ? 'required' : 'optional')}
                            hint={text('nameHint')}
                            value={values[field]}
                            onChange={(event) => {
                              update({ [field]: event.target.value });
                            }}
                            maxLength={80}
                            required={required}
                            dir={language === 'ar' ? 'rtl' : 'ltr'}
                            lang={language}
                            autoComplete="off"
                            error={fieldErrors[field]}
                            disabled={pending}
                          />
                        );
                      })}
                      <div className="flex flex-col gap-1">
                        <label htmlFor="role-description" className="text-sm font-medium">
                          {text('description')}
                          <span className="ms-1 font-normal text-text-muted">
                            {text('optional')}
                          </span>
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
                          <p
                            id="role-description-error"
                            className="m-0 text-sm font-medium text-danger"
                          >
                            {fieldErrors.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </Card>

                  <Card title={text('dataScope')}>
                    <div className="flex flex-col gap-3">
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
                        <p
                          id="role-scope-error"
                          // Takes the focus after a refusal (the choice cards carry no message of their own).
                          tabIndex={-1}
                          data-refusal
                          className="m-0 text-sm font-medium text-danger"
                        >
                          {fieldErrors.dataScope}
                        </p>
                      ) : null}
                    </div>
                  </Card>
                </>
              ) : null}
              {tab === 'permissions' ? (
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
                          update({
                            permissions: togglePermission(groups, values.permissions, code, on),
                          });
                          // A tick after the scope change: «Undo» would throw it away, so it is no longer offered.
                          setCleared(null);
                        }}
                        countLabel={(checked, total) => count(text('countLabel'), checked, total)}
                        idPrefix="role-permission"
                        defaultOpen="all"
                        data-testid="role-permissions"
                      />
                    )}
                    {fieldErrors.permissions ? (
                      <p
                        className="m-0 text-sm font-medium text-danger"
                        role="alert"
                        // Takes the focus after a refusal (WCAG 3.3.1).
                        tabIndex={-1}
                        data-refusal
                      >
                        {fieldErrors.permissions}
                      </p>
                    ) : null}
                  </div>
                </Card>
              ) : null}
              {tab === 'holders' ? (
                <Card title={text('summary')}>
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
                  {!privileged && props.holdersText ? (
                    <p className="m-0 mt-3 text-sm font-medium" data-testid="role-holders">
                      {props.holdersText}
                    </p>
                  ) : null}
                  <p className="m-0 mt-3 flex gap-2 text-sm text-text-muted">
                    <Icon name="shield" className="mt-0.5 size-4 shrink-0" />
                    {text('audited')}
                  </p>
                </Card>
              ) : null}
            </div>
            {message ? (
              <Alert tone="danger" data-testid="role-builder-message">
                {message}
                <LoadLatestVersion message={message} />
              </Alert>
            ) : null}
          </form>
          {tab === 'holders' ? props.holders : null}
        </div>
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
          close: text('close'),
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
