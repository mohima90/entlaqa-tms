/**
 * The sender rule's inputs as the database returns them (private.email_route() for the worker,
 * private.auth_mail_route() for the web tier's Send Email hook) and their mapping. Kept outside `jobs/` because
 * the web tier (auth-mail.ts) uses it too; the worker re-exports it from jobs/email.ts.
 */

/** The sender rule's inputs for the job's organization (private.email_route). */
export interface EmailRouteRow {
  readonly tenant: {
    readonly provider: string;
    readonly options: unknown;
    readonly credentialsSealed: string;
    readonly fromName: string;
    readonly fromAddress: string;
    readonly replyTo: string | null;
    /** Enabled AND verified. */
    readonly enabled: boolean;
    readonly version: number;
  } | null;
  readonly platform: {
    readonly provider: string;
    readonly options: unknown;
    readonly credentialsSealed: string;
    readonly fromAddress: string;
    readonly verified: boolean;
    readonly version: number;
  } | null;
  readonly brandNameAr: string;
  readonly brandNameEn: string | null;
  readonly defaultLocale: 'ar' | 'en';
}

/** The columns private.email_route() and private.auth_mail_route() return. */
export interface EmailRouteSqlRow {
  readonly tenant_provider: string | null;
  readonly tenant_options: unknown;
  readonly tenant_credentials_sealed: string | null;
  readonly tenant_from_name: string | null;
  readonly tenant_from_address: string | null;
  readonly tenant_reply_to: string | null;
  readonly tenant_enabled: boolean;
  readonly tenant_version: number | null;
  readonly platform_configured: boolean;
  readonly platform_provider: string | null;
  readonly platform_options: unknown;
  readonly platform_credentials_sealed: string | null;
  readonly platform_from_address: string | null;
  readonly platform_verified: boolean;
  readonly platform_version: number | null;
  readonly brand_name_ar: string;
  readonly brand_name_en: string | null;
  readonly default_locale: string;
}

export function toEmailRouteRow(r: EmailRouteSqlRow): EmailRouteRow {
  return {
    tenant:
      r.tenant_provider !== null &&
      r.tenant_credentials_sealed !== null &&
      r.tenant_from_name !== null &&
      r.tenant_from_address !== null
        ? {
            provider: r.tenant_provider,
            options: r.tenant_options,
            credentialsSealed: r.tenant_credentials_sealed,
            fromName: r.tenant_from_name,
            fromAddress: r.tenant_from_address,
            replyTo: r.tenant_reply_to,
            enabled: r.tenant_enabled,
            version: r.tenant_version ?? 0,
          }
        : null,
    platform:
      r.platform_configured &&
      r.platform_provider !== null &&
      r.platform_credentials_sealed !== null &&
      r.platform_from_address !== null
        ? {
            provider: r.platform_provider,
            options: r.platform_options,
            credentialsSealed: r.platform_credentials_sealed,
            fromAddress: r.platform_from_address,
            verified: r.platform_verified,
            version: r.platform_version ?? 0,
          }
        : null,
    brandNameAr: r.brand_name_ar,
    brandNameEn: r.brand_name_en,
    defaultLocale: r.default_locale === 'ar' ? 'ar' : 'en',
  };
}
