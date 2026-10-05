import 'server-only';

export { type SupabaseAuthLike, verifyClaims, verifyClaimsStrict } from './verify-claims';
export {
  type AuthClientLike,
  type AuthFlowDeps,
  type SignInOutcome,
  IdentityErrors,
  getSessionOrganizations,
  selectOrganization,
  signInWithPassword,
  signOut,
} from './auth-flow';
export {
  type PasswordChangeDeps,
  type PasswordClientLike,
  type PasswordVerdict,
  PasswordErrors,
  changePassword,
} from './password';
