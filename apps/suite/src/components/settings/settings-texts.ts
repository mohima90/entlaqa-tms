/** The common texts of the organization settings pages (redesign package 2), translated on the server. */
export interface SettingsCommonTexts {
  /** «لديك تغييرات لم تُحفظ.» / "You have unsaved changes." */
  readonly unsavedChanges: string;
  /** The save bar after a refused Save: "Some fields need correcting. Check the highlighted fields." */
  readonly invalid: string;
  readonly undo: string;
  readonly reload: string;
  /** Raw: "Go to {field}". */
  readonly goToField: string;
  readonly leaveTitle: string;
  readonly leaveText: string;
  readonly leaveStay: string;
  readonly leaveGo: string;
  readonly edit: string;
  readonly saved: string;
  readonly close: string;
  /** «(مطلوب)» / "(required)" after a label. */
  readonly required: string;
  /** The «Verify with the app» banner: mfa.stepUpIntro and profile.mfa.verifyFirst. */
  readonly stepUpIntro: string;
  readonly verifyFirst: string;
}
