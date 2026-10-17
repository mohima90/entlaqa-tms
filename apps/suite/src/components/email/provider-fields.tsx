'use client';
import { TextField } from '@jadarat/ui';
import type { EmailProviderId } from '@jadarat/platform-notifications';
import {
  PROVIDER_CHOICES,
  PROVIDER_FIELDS,
  type ProviderField,
  type ProviderFormValues,
} from '../../lib/email-settings-form';
import { SelectField } from '../select-field';

/**
 * The provider part of both e-mail settings pages (WP-ADM-01; Kawadir's provider tab): the provider choice
 * and its fields — options shown back, secrets write-only (type password, never filled in, autocomplete
 * off; "A value is saved. Leave empty to keep it." when one is saved and usable) — and, for Microsoft 365,
 * the set-up steps of the app registration.
 */
export function ProviderFields({
  idPrefix,
  values,
  onChange,
  disabled,
  secretState,
  errors,
  texts,
}: {
  readonly idPrefix: string;
  readonly values: ProviderFormValues;
  readonly onChange: (values: ProviderFormValues) => void;
  readonly disabled: boolean;
  /** For the CHOSEN provider: none saved, saved and usable (keep when empty), or saved with an old key. */
  readonly secretState: 'none' | 'saved' | 'keyChanged';
  readonly errors: Readonly<Record<string, string | undefined>>;
  /** emailSettings texts, flattened. */
  readonly texts: Readonly<Record<string, string>>;
}) {
  const t = (key: string) => texts[key] ?? key;
  const set = (field: ProviderField, value: string) => {
    onChange({ ...values, [field]: value });
  };
  const id = (field: string) => `${idPrefix}-${field}`;
  const secretHint = () =>
    secretState === 'saved'
      ? `${t('provider.secretSaved')} ${t('provider.secretHint')}`
      : secretState === 'keyChanged'
        ? t('provider.secretKeyChanged')
        : t('provider.secretHint');
  const required = secretState === 'saved' ? t('provider.optional') : t('provider.required');

  function field(name: ProviderField, secret: boolean) {
    const common = {
      id: id(name),
      name,
      disabled,
      error: errors[name],
      'data-testid': id(name),
    };
    switch (name) {
      case 'apiKey':
        return (
          <TextField
            key={name}
            {...common}
            type="password"
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            label={t('provider.apiKey')}
            marker={required}
            hint={`${t(`provider.apiKeyHint.${values.provider}`)} ${secretHint()}`}
            value={values.apiKey}
            onChange={(event) => {
              set('apiKey', event.target.value);
            }}
          />
        );
      case 'smtpPassword':
      case 'graphClientSecret':
        return (
          <TextField
            key={name}
            {...common}
            type="password"
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            label={t(`provider.${name}`)}
            marker={name === 'smtpPassword' ? t('provider.optional') : required}
            hint={secretHint()}
            value={values[name]}
            onChange={(event) => {
              set(name, event.target.value);
            }}
          />
        );
      case 'mailgunRegion':
        return (
          <SelectField
            key={name}
            {...common}
            label={t('provider.mailgunRegion')}
            value={values.mailgunRegion}
            onChange={(event) => {
              set('mailgunRegion', event.target.value);
            }}
          >
            <option value="us">{t('provider.regionUs')}</option>
            <option value="eu">{t('provider.regionEu')}</option>
          </SelectField>
        );
      case 'smtpSecurity':
        return (
          <SelectField
            key={name}
            {...common}
            label={t('provider.smtpSecurity')}
            value={values.smtpSecurity}
            onChange={(event) => {
              set('smtpSecurity', event.target.value);
            }}
          >
            <option value="starttls">{t('provider.securityStarttls')}</option>
            <option value="tls">{t('provider.securityTls')}</option>
          </SelectField>
        );
      default: {
        const hints: Partial<Record<ProviderField, string>> = {
          mailgunDomain: t('provider.mailgunDomainHint'),
          smtpHost: t('provider.smtpHostHint'),
          smtpUsername: t('provider.smtpUsernameHint'),
        };
        return (
          <TextField
            key={name}
            {...common}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            inputMode={name === 'smtpPort' ? 'numeric' : undefined}
            label={t(`provider.${name}`)}
            marker={name === 'smtpUsername' ? t('provider.optional') : t('provider.required')}
            hint={hints[name] ?? (secret ? secretHint() : undefined)}
            value={values[name]}
            onChange={(event) => {
              set(name, event.target.value);
            }}
          />
        );
      }
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SelectField
        id={id('provider')}
        name="provider"
        label={t('provider.label')}
        value={values.provider}
        disabled={disabled}
        error={errors.provider}
        onChange={(event) => {
          onChange({ ...values, provider: event.target.value as EmailProviderId });
        }}
        data-testid={id('provider')}
      >
        {PROVIDER_CHOICES.map((choice) => (
          <option key={choice.value} value={choice.value} lang="en" dir="ltr">
            {choice.label}
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-5">
        {PROVIDER_FIELDS[values.provider].map((f) => field(f.field, f.secret))}
      </div>
      {values.provider === 'microsoft_graph' ? (
        <section
          aria-labelledby={id('graph-steps')}
          className="rounded-lg border border-border bg-surface-sunken p-4 text-sm"
        >
          <h3 id={id('graph-steps')} className="m-0 mb-2 text-sm font-semibold">
            {t('provider.graphTitle')}
          </h3>
          <ol className="m-0 flex list-decimal flex-col gap-1 ps-5">
            {['graphStep1', 'graphStep2', 'graphStep3', 'graphStep4', 'graphStep5'].map((step) => (
              <li key={step}>{t(`provider.${step}`)}</li>
            ))}
          </ol>
          <p className="m-0 mt-2 text-text-muted">{t('provider.graphNote')}</p>
        </section>
      ) : null}
    </div>
  );
}
