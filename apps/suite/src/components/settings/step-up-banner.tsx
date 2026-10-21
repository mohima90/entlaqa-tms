import { Alert, Icon, buttonClasses } from '@jadarat/ui';
import type { SettingsCommonTexts } from './settings-texts';

/**
 * «يتطلب هذا الإجراء رمز التحقق…» / "This action needs a verification code from your authenticator app."
 * with «Verify with the app» (redesign package 2, Q2-1): shown before editing when saving the page needs
 * a fresh code, and after the server refused a save for that reason. The link opens the existing /mfa
 * step-up page, which brings the member back here (`stepUpHref`).
 */
export function StepUpBanner({
  href,
  texts,
}: {
  readonly href: string;
  readonly texts: Pick<SettingsCommonTexts, 'stepUpIntro' | 'verifyFirst'>;
}) {
  return (
    <Alert
      tone="info"
      title={texts.stepUpIntro}
      data-testid="settings-step-up"
      action={
        <a
          href={href}
          className={buttonClasses({ size: 'sm' })}
          data-testid="settings-step-up-link"
        >
          <Icon name="key" />
          {texts.verifyFirst}
        </a>
      }
    />
  );
}
