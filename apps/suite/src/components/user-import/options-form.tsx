import { buttonClasses } from '@jadarat/ui';

export interface OptionsFormProps {
  readonly backHref: string;
  readonly initial: {
    readonly existing: 'skip' | 'upsert' | 'update_only';
    readonly defaultRole: string;
    readonly invitations: 'send' | 'hold';
  };
  /** May update existing people's data (platform.user.update). */
  readonly canUpdate: boolean;
  readonly roles: readonly { readonly code: string; readonly name: string }[];
  /** Formatted on the server (counts and names filled in). */
  readonly labels: Readonly<Record<string, string>>;
}

const EXISTING = ['skip', 'upsert', 'update_only'] as const;
const INVITATIONS = ['send', 'hold'] as const;

/**
 * Step 4 «الخيارات» (approved screen 7): existing people (skip — default —, add and update, update only),
 * the default primary role (non-privileged roles only), invitations now or later. A plain GET form (no
 * client script): the choice travels to step 5 in the URL; the server checks it again when the import is
 * confirmed.
 */
export function OptionsForm(props: OptionsFormProps) {
  const text = (key: string) => props.labels[key] ?? key;

  return (
    <form method="get" className="flex flex-col gap-6" data-testid="options-form">
      <input type="hidden" name="step" value="confirm" />
      <fieldset className="m-0 flex flex-col gap-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-lg font-semibold">{text('existingHeading')}</legend>
        <p className="m-0 text-sm text-text-muted">{text('existingHint')}</p>
        {EXISTING.map((value) => {
          const disabled = value !== 'skip' && !props.canUpdate;
          return (
            <div key={value} className="flex min-h-11 items-start gap-3">
              <input
                id={`existing-${value}`}
                type="radio"
                name="existing"
                value={value}
                defaultChecked={props.initial.existing === value}
                disabled={disabled}
                aria-describedby={`existing-${value}-hint`}
                className="mt-1 size-5"
                data-testid={`existing-${value}`}
              />
              <div>
                <label htmlFor={`existing-${value}`} className="font-medium">
                  {text(`existing.${value}`)}
                </label>
                <p id={`existing-${value}-hint`} className="m-0 text-sm text-text-muted">
                  {disabled ? text('updateNotAllowed') : text(`existing.${value}Hint`)}
                </p>
              </div>
            </div>
          );
        })}
        <p className="m-0 text-sm text-text-muted">{text('existingNote')}</p>
      </fieldset>

      <div className="flex flex-col gap-1 rounded-lg border border-border p-4">
        <label htmlFor="default-role" className="text-lg font-semibold">
          {text('defaultRole')}
        </label>
        <p id="default-role-hint" className="m-0 text-sm text-text-muted">
          {text('defaultRoleHint')}
        </p>
        <select
          id="default-role"
          name="defaultRole"
          defaultValue={props.initial.defaultRole}
          aria-describedby="default-role-hint default-role-privileged"
          className="mt-2 min-h-11 rounded-md border border-border-strong bg-surface px-3 text-text sm:w-80"
          data-testid="default-role"
        >
          {props.roles.map((role) => (
            <option key={role.code} value={role.code}>
              {role.name}
            </option>
          ))}
        </select>
        <p id="default-role-privileged" className="mb-0 mt-2 text-sm text-text-muted">
          {text('privilegedNote')}
        </p>
      </div>

      <fieldset className="m-0 flex flex-col gap-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-lg font-semibold">{text('invitationsHeading')}</legend>
        {INVITATIONS.map((value) => (
          <div key={value} className="flex min-h-11 items-start gap-3">
            <input
              id={`invitations-${value}`}
              type="radio"
              name="invitations"
              value={value}
              defaultChecked={props.initial.invitations === value}
              aria-describedby={`invitations-${value}-hint`}
              className="mt-1 size-5"
              data-testid={`invitations-${value}`}
            />
            <div>
              <label htmlFor={`invitations-${value}`} className="font-medium">
                {text(`invitations.${value}`)}
              </label>
              <p id={`invitations-${value}-hint`} className="m-0 text-sm text-text-muted">
                {text(`invitations.${value}Hint`)}
              </p>
            </div>
          </div>
        ))}
        <p className="m-0 text-sm text-text-muted">{text('invitationsNote')}</p>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <a href={props.backHref} className={buttonClasses({ variant: 'secondary', size: 'md' })}>
          {text('back')}
        </a>
        <button
          type="submit"
          className={buttonClasses({ variant: 'primary', size: 'md' })}
          data-testid="options-next"
        >
          {text('next')}
        </button>
      </div>
    </form>
  );
}
