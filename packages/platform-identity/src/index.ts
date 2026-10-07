import 'server-only';

export { type SupabaseAuthLike, verifyClaims, verifyClaimsStrict } from './verify-claims';
export {
  type InvitationAcceptDeps,
  type InvitationAcceptOutcome,
  type InvitationLinkView,
  type InvitationSignUpClientLike,
  type InvitationViewer,
  INVITATION_TOKEN_PATTERN,
  InvitationAccountError,
  InvitationErrors,
  acceptInvitationAsSignedInUser,
  acceptInvitationWithNewAccount,
  acceptInvitationWithPassword,
  lookupInvitation,
  lookupInvitationLink,
  sessionEmail,
} from './invitation-accept';
export {
  type AuthClientLike,
  type AuthFlowDeps,
  type PasswordSession,
  type SessionTokens,
  type SignInOutcome,
  IdentityErrors,
  getSessionOrganizations,
  selectOrganization,
  signInWithPassword,
  signOut,
  startPasswordSession,
} from './auth-flow';
export {
  type PasswordChangeDeps,
  type PasswordClientLike,
  type PasswordVerdict,
  type VerifierClientLike,
  PasswordErrors,
  changePassword,
  createPasswordVerifier,
} from './password';
