import type { EmailProviderId } from '@jadarat/platform-notifications';

/**
 * The provider part of the two e-mail settings pages (WP-ADM-01; Kawadir's provider fields): the Super Admin's
 * Platform settings → Email and the Organization Admin's Email integration. Plain values of the form (all
 * strings), built into the action's input here. Secret fields are write-only: they start empty, and an empty
 * secret keeps the saved one (same provider only — the database refuses otherwise).
 */
export interface ProviderFormValues {
  readonly provider: EmailProviderId;
  readonly apiKey: string;
  readonly smtpHost: string;
  readonly smtpPort: string;
  readonly smtpSecurity: 'starttls' | 'tls';
  readonly smtpUsername: string;
  readonly smtpPassword: string;
  readonly mailgunDomain: string;
  readonly mailgunRegion: 'us' | 'eu';
  readonly graphTenantId: string;
  readonly graphClientId: string;
  readonly graphClientSecret: string;
}

export type ProviderField = Exclude<keyof ProviderFormValues, 'provider'>;

/** The provider choices in Kawadir's order; product names are not translated. */
export const PROVIDER_CHOICES: readonly {
  readonly value: EmailProviderId;
  readonly label: string;
}[] = [
  { value: 'resend', label: 'Resend' },
  { value: 'smtp', label: 'SMTP' },
  { value: 'sendgrid', label: 'SendGrid' },
  { value: 'mailgun', label: 'Mailgun' },
  { value: 'microsoft_graph', label: 'Microsoft 365' },
];

export function providerLabel(provider: string): string {
  return PROVIDER_CHOICES.find((c) => c.value === provider)?.label ?? provider;
}

/** The fields each provider shows, in order (secret fields marked). */
export const PROVIDER_FIELDS: Readonly<
  Record<EmailProviderId, readonly { readonly field: ProviderField; readonly secret: boolean }[]>
> = {
  resend: [{ field: 'apiKey', secret: true }],
  sendgrid: [{ field: 'apiKey', secret: true }],
  mailgun: [
    { field: 'apiKey', secret: true },
    { field: 'mailgunDomain', secret: false },
    { field: 'mailgunRegion', secret: false },
  ],
  smtp: [
    { field: 'smtpHost', secret: false },
    { field: 'smtpPort', secret: false },
    { field: 'smtpSecurity', secret: false },
    { field: 'smtpUsername', secret: false },
    { field: 'smtpPassword', secret: true },
  ],
  microsoft_graph: [
    { field: 'graphTenantId', secret: false },
    { field: 'graphClientId', secret: false },
    { field: 'graphClientSecret', secret: true },
  ],
};

const text = (options: Record<string, unknown>, key: string, fallback = ''): string => {
  const value = options[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
};

/** The form's starting values from what is saved (never a secret: secrets start empty). */
export function providerFormValues(
  saved: { readonly provider: string; readonly options: Record<string, unknown> } | null,
): ProviderFormValues {
  const provider = PROVIDER_CHOICES.some((c) => c.value === saved?.provider)
    ? (saved?.provider as EmailProviderId)
    : 'resend';
  const options = saved?.options ?? {};
  return {
    provider,
    apiKey: '',
    smtpHost: text(options, 'host'),
    smtpPort: text(options, 'port', '587'),
    smtpSecurity: options.security === 'tls' ? 'tls' : 'starttls',
    smtpUsername: text(options, 'username'),
    smtpPassword: '',
    mailgunDomain: text(options, 'domain'),
    mailgunRegion: options.region === 'eu' ? 'eu' : 'us',
    graphTenantId: text(options, 'tenantId'),
    graphClientId: text(options, 'clientId'),
    graphClientSecret: '',
  };
}

/**
 * The saved secret of the CHOSEN provider: none saved (another provider), saved and usable (empty = keep),
 * saved with an old worker key (enter again), or an SMTP password saved for another server — host, port or
 * encryption changed: the password is never reused for another server (enter it again; the database and
 * the worker refuse it too).
 */
export type SecretState = 'none' | 'saved' | 'keyChanged' | 'serverChanged';

export function secretStateFor(
  saved: {
    readonly provider: string;
    readonly options: Record<string, unknown>;
    readonly credentialsCurrent: boolean;
  } | null,
  values: ProviderFormValues,
): SecretState {
  if (saved?.provider !== values.provider) return 'none';
  if (values.provider === 'smtp') {
    const before = providerFormValues(saved);
    if (
      before.smtpHost.trim().toLowerCase() !== values.smtpHost.trim().toLowerCase() ||
      before.smtpPort.trim() !== values.smtpPort.trim() ||
      before.smtpSecurity !== values.smtpSecurity
    ) {
      return 'serverChanged';
    }
  }
  return saved.credentialsCurrent ? 'saved' : 'keyChanged';
}

/** The secret fields of the chosen provider are all empty (keep the saved secrets). */
export function secretsLeftEmpty(values: ProviderFormValues): boolean {
  return PROVIDER_FIELDS[values.provider]
    .filter((f) => f.secret)
    .every((f) => values[f.field] === '');
}

/**
 * The action's `provider` input: options and secrets of the chosen provider. `keepSecrets`: the saved
 * provider is this one and its secrets are usable — empty secret fields then mean "keep" (null).
 */
export function providerInput(values: ProviderFormValues, keepSecrets: boolean): unknown {
  const keep = keepSecrets && secretsLeftEmpty(values);
  switch (values.provider) {
    case 'resend':
    case 'sendgrid':
      return {
        provider: values.provider,
        options: {},
        secrets: keep ? null : { apiKey: values.apiKey.trim() },
      };
    case 'mailgun':
      return {
        provider: 'mailgun',
        options: { domain: values.mailgunDomain.trim(), region: values.mailgunRegion },
        secrets: keep ? null : { apiKey: values.apiKey.trim() },
      };
    case 'smtp':
      return {
        provider: 'smtp',
        options: {
          host: values.smtpHost.trim(),
          port: /^\d{1,5}$/.test(values.smtpPort.trim()) ? Number(values.smtpPort.trim()) : -1,
          security: values.smtpSecurity,
          username: values.smtpUsername.trim(),
        },
        // A relay without sign-in has no password: an empty one is saved (sealed) the first time.
        secrets: keep ? null : { password: values.smtpPassword },
      };
    case 'microsoft_graph':
      return {
        provider: 'microsoft_graph',
        options: { tenantId: values.graphTenantId.trim(), clientId: values.graphClientId.trim() },
        secrets: keep ? null : { clientSecret: values.graphClientSecret.trim() },
      };
  }
}

/** The form field a server field error belongs to (`provider.options.host` → smtpHost). */
export function fieldOfPath(path: string, provider: EmailProviderId): string {
  const [head, group, key] = path.split('.');
  if (head !== 'provider') return head ?? 'form';
  if (group === 'secrets') {
    if (provider === 'smtp') return 'smtpPassword';
    if (provider === 'microsoft_graph') return 'graphClientSecret';
    return 'apiKey';
  }
  if (group === 'options') {
    const map: Readonly<Record<string, string>> = {
      host: 'smtpHost',
      port: 'smtpPort',
      security: 'smtpSecurity',
      username: 'smtpUsername',
      domain: 'mailgunDomain',
      region: 'mailgunRegion',
      tenantId: 'graphTenantId',
      clientId: 'graphClientId',
    };
    return (key && map[key]) ?? 'provider';
  }
  return 'provider';
}

/** The e-mail kinds of the delivery errors list (message key under `emailSettings.templates`). */
export function templateKey(template: string): string {
  // An e-mail that goes out with the platform sender only is the same kind of e-mail for the list.
  if (template.endsWith('_platform')) return templateKey(template.slice(0, -'_platform'.length));
  const known = [
    'platform.invitation',
    'platform.password_reset',
    'platform.password_changed',
    'platform.mfa_factor_added',
    'platform.mfa_factor_removed',
    'platform.security_policy_changed',
    'platform.security_digest',
    'platform.account_locked',
    'platform.sign_in_unlocked',
    'platform.mfa_code_locked',
    'platform.sign_in_code',
  ];
  return known.includes(template) ? template.replace('platform.', '') : 'other';
}
