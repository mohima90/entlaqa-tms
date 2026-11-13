'use client';
import { Alert, Button, Dialog, Icon, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  type SyntheticEvent,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { createCustomRoleAction } from '../../actions/roles';
import { type BuilderStart, builderFieldError } from '../../lib/role-builder';
import { nameOrder } from '../../lib/structure-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';

/** What «Create role» needs (prepared on the server for the Organization Admin). */
export interface CreateRoleSetup {
  /** «Start from» choices: a blank role, a copy of a standard role, a template — values already applied. */
  readonly starts: readonly BuilderStart[];
  /** The language whose name is required: the organization's default language (PO, 12 Nov 2026). */
  readonly nameLanguage: 'ar' | 'en';
  /** Texts by key (`roleCreateTexts`). */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** The roles list (locale included): a new role opens at `<rolesHref>/<code>`. */
  readonly rolesHref: string;
  readonly locale: 'ar' | 'en';
}

interface CreateRoleContextValue {
  /** Opens the popup, optionally on a start (`standard:<code>`); `from`: the id of the control to return to. */
  readonly open: (start: string | null, from: string) => void;
}

const CreateRoleContext = createContext<CreateRoleContextValue | null>(null);
const CREATE_ROLE_ID = 'create-role';

/**
 * «Create role» on Roles & permissions (the Kawadir pattern — forms standard rule 9; WP-UX-01 c, T-M3-21;
 * FR-IAM-07): one centred popup, 672 px, with «Start from» (a blank role, a copy of a standard role or a
 * template) and the role's name in the organization's default language (the other language optional).
 * Creating stores the role with what its start gives (scope, permissions, a template's description) —
 * exactly what the former create page sent — and opens the builder as the role's own page, where the
 * permissions and the data it sees are changed. The provider holds the popup; the page's buttons and the
 * row menus open it (`CreateRoleButton`, `useCreateRole`). `initial`: the page came with `?new=1`
 * (`&from=standard:<code>`), e.g. from «Create a role from it» on a standard role's page.
 */
export function CreateRoleProvider({
  setup,
  initial,
  children,
}: {
  /** Null for members who do not build roles: the children render without the popup. */
  readonly setup: CreateRoleSetup | null;
  readonly initial: { readonly start: string | null } | null;
  readonly children: ReactNode;
}) {
  const [state, setState] = useState<{ readonly start: string | null } | null>(
    setup ? initial : null,
  );
  const [busy, setBusy] = useState(false);
  // The control that opened the popup: focus goes back to it («Create role» when it is gone).
  const returnTo = useRef<string>(CREATE_ROLE_ID);

  // The popup came with the address: taken out of it, so a reload or a shared link does not reopen it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('new') && !url.searchParams.has('from')) return;
    url.searchParams.delete('new');
    url.searchParams.delete('from');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  }, []);

  const open = useCallback((start: string | null, from: string) => {
    returnTo.current = from;
    setState({ start });
  }, []);
  const value = useMemo(() => ({ open }), [open]);

  if (!setup) return <>{children}</>;
  return (
    <CreateRoleContext.Provider value={value}>
      {children}
      <Dialog
        open={state !== null}
        onClose={() => {
          setState(null);
          window.setTimeout(() => {
            (
              document.getElementById(returnTo.current) ?? document.getElementById(CREATE_ROLE_ID)
            )?.focus();
          }, 0);
        }}
        canClose={() => !busy}
        size="rich"
        title={setup.texts.titleNew ?? ''}
        description={setup.texts.newIntro}
        closeLabel={setup.texts.close ?? ''}
        data-testid="role-create-dialog"
      >
        {state ? (
          <CreateRoleForm
            setup={setup}
            initialStart={state.start}
            onBusy={setBusy}
            onCancel={() => {
              setState(null);
            }}
          />
        ) : null}
      </Dialog>
    </CreateRoleContext.Provider>
  );
}

/** Opens «Create role» from a control inside the provider; null outside it (or without the right). */
export function useCreateRole(): CreateRoleContextValue | null {
  return useContext(CreateRoleContext);
}

/** «Create role» — the page's primary action, and the empty state's. */
export function CreateRoleButton({
  id = CREATE_ROLE_ID,
  label,
  testId = 'create-role-link',
}: {
  readonly id?: string;
  readonly label: string;
  readonly testId?: string;
}) {
  const create = useCreateRole();
  if (!create) return null;
  return (
    <Button
      id={id}
      onClick={() => {
        create.open(null, id);
      }}
      data-testid={testId}
    >
      <Icon name="plus" />
      {label}
    </Button>
  );
}

type Field = 'nameEn' | 'nameAr';

function CreateRoleForm({
  setup,
  initialStart,
  onBusy,
  onCancel,
}: {
  readonly setup: CreateRoleSetup;
  readonly initialStart: string | null;
  readonly onBusy: (busy: boolean) => void;
  readonly onCancel: () => void;
}) {
  const { texts, starts } = setup;
  const text = (key: string) => texts[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const blank = starts.find((s) => s.group === 'blank') ?? starts[0];
  const first = starts.find((s) => s.value === initialStart) ?? blank;
  const [start, setStart] = useState(first?.value ?? '');
  // A template comes with its names; a blank role or a copy of a standard role is named by the person.
  const [names, setNames] = useState<Record<Field, string>>({
    nameEn: first?.nameEn ?? '',
    nameAr: first?.nameAr ?? '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  // While the role is being created the popup stays (Escape, the close button, the backdrop).
  useEffect(() => {
    onBusy(pending);
  }, [pending, onBusy]);

  function onStart(value: string) {
    setStart(value);
    const choice = starts.find((s) => s.value === value);
    if (!choice) return;
    // A template fills in its names (as the builder did); other starts keep what was typed.
    setNames((current) => ({
      nameEn: choice.nameEn ?? current.nameEn,
      nameAr: choice.nameAr ?? current.nameAr,
    }));
    setFieldErrors({});
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const choice = starts.find((s) => s.value === start) ?? blank;
    if (!choice) return;
    const required: Field = setup.nameLanguage === 'ar' ? 'nameAr' : 'nameEn';
    if (names[required].trim() === '') {
      setFieldErrors({ [required]: text('fieldErrors.required') });
      return;
    }
    startTransition(async () => {
      const result = await createCustomRoleAction({
        nameEn: names.nameEn,
        nameAr: names.nameAr,
        description: choice.description ?? '',
        dataScope: choice.dataScope,
        permissions: [...choice.permissions],
      });
      if (result.ok) {
        toast.success(text('created'));
        // The builder opens as the role's own page: its permissions and the data it sees.
        router.push(`${setup.rolesHref}/${result.value.code}`);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      if (result.error.code === 'VALIDATION_FAILED') {
        const next: Partial<Record<Field, string>> = {};
        for (const fieldError of result.error.fieldErrors ?? []) {
          const mapped = builderFieldError(fieldError.path, fieldError.code);
          if (mapped && (mapped.field === 'nameEn' || mapped.field === 'nameAr')) {
            next[mapped.field] ??= text(`fieldErrors.${mapped.key}`);
          }
        }
        setFieldErrors(next);
      }
      setMessage(errorText(result.error, setup.errors));
    });
  }

  const groups = (['blank', 'standard', 'template'] as const).map((group) => ({
    group,
    starts: starts.filter((s) => s.group === group),
  }));

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" data-testid="role-create">
      {message ? (
        <Alert tone="danger" data-testid="role-create-message">
          {message}
        </Alert>
      ) : null}
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
        {groups.map(({ group, starts: choices }) =>
          group === 'blank' ? (
            choices.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))
          ) : choices.length > 0 ? (
            <optgroup
              key={group}
              label={text(group === 'standard' ? 'startStandard' : 'startTemplate')}
            >
              {choices.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </SelectField>
      {/* The name in the organization's default language first and required; the other language is
          optional (PO, 12 Nov 2026). Side by side on a desktop, one per row on a phone. */}
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        {nameOrder(setup.nameLanguage).map((language) => {
          const field: Field = language === 'ar' ? 'nameAr' : 'nameEn';
          const required = language === setup.nameLanguage;
          return (
            <TextField
              key={field}
              id={`role-name-${language}`}
              label={text(field)}
              marker={text(required ? 'required' : 'optional')}
              value={names[field]}
              onChange={(event) => {
                const value = event.target.value;
                setNames((current) => ({ ...current, [field]: value }));
                setFieldErrors(({ [field]: _fixed, ...rest }) => rest);
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
      </div>
      <p
        className="m-0 rounded-xl bg-surface-sunken px-3.5 py-3 text-[13px] leading-relaxed text-text-muted"
        data-testid="role-create-note"
      >
        {text('newNote')}
      </p>
      {/* «Cancel», then the primary button at the end; the footer stays in view on a short screen. */}
      <div className="sticky bottom-0 -mx-6 -mb-6 mt-1.5 flex flex-col-reverse gap-2.5 border-t border-border bg-surface-raised px-6 py-4 sm:-mx-6.5 sm:-mb-6.5 sm:flex-row sm:flex-wrap sm:justify-end sm:px-6.5">
        <Button
          variant="secondary"
          onClick={onCancel}
          disabled={pending}
          data-testid="role-create-cancel"
        >
          {text('cancel')}
        </Button>
        <Button type="submit" disabled={pending} busy={pending} data-testid="role-create-submit">
          {pending ? text('creating') : text('titleNew')}
        </Button>
      </div>
    </form>
  );
}
