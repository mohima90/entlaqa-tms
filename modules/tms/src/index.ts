export { tmsPermissions } from './permissions';
export * from './planning/model';
export * from './planning/definitions';
export { SessionDraftInput, type SessionDraft, buildSessionDraft } from './services/session-draft';

/** Navigation entries the TMS module registers with the suite shell (docs/design/suite-shell.md). */
export const tmsNavigation = [
  { key: 'home', href: '/suite' },
  { key: 'calendar', href: '/suite/calendar' },
  { key: 'sessions', href: '/suite/sessions' },
  { key: 'courses', href: '/suite/courses' },
] as const;

/** Planning entries (EP-PLN, T-M3-04): the cycles list and the planning settings. */
export const tmsPlanningNavigation = [
  { key: 'planningCycles', href: '/suite/planning/cycles' },
  { key: 'planningSettings', href: '/suite/planning/settings' },
] as const;
