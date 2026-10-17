export { tmsPermissions } from './permissions';
export { SessionDraftInput, type SessionDraft, buildSessionDraft } from './services/session-draft';
export * from './courses/model';

/** Navigation entries the TMS module registers with the suite shell (docs/design/suite-shell.md). */
export const tmsNavigation = [
  { key: 'home', href: '/suite' },
  { key: 'calendar', href: '/suite/calendar' },
  { key: 'sessions', href: '/suite/sessions' },
  { key: 'courses', href: '/suite/courses' },
] as const;
