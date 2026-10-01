import type { TenantClaims } from './claims';
import type { Uuid } from './ids';

export type Locale = 'ar' | 'en';

export type TenantStatus = 'trial' | 'active' | 'suspended' | 'cancelled';

/** Tenant resolved from the request host (ADR 0002 §4). Never from client-supplied input. */
export interface HostTenant {
  readonly tenantId: Uuid;
  readonly slug: string;
  readonly status: TenantStatus;
}

export type Aal = 'aal1' | 'aal2';

/** The authenticated actor, derived from verified claims only. */
export interface ActorContext {
  readonly userId: Uuid;
  readonly personId: Uuid | null;
  readonly tenantId: Uuid;
  readonly aal: Aal;
  /** Set when platform staff act under a support grant (ADR 0003 §6). */
  readonly impersonatorUserId: Uuid | null;
}

/** Per-request context passed to services. */
export interface RequestContext {
  readonly requestId: string;
  readonly locale: Locale;
  readonly hostTenant: HostTenant | null;
  readonly actor: ActorContext | null;
}

/** The actor of a request, from verified tenant claims only (never from client input). */
export function actorFromClaims(claims: TenantClaims): ActorContext {
  return {
    userId: claims.sub as Uuid,
    personId: (claims.person_id ?? null) as Uuid | null,
    tenantId: claims.tenant_id as Uuid,
    aal: claims.aal ?? 'aal1',
    impersonatorUserId: (claims.actor ?? null) as Uuid | null,
  };
}
