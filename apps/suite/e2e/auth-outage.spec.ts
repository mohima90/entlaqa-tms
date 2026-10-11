import { expect, test } from '@playwright/test';
import { afterSignIn, submitSignIn } from './sign-in';

/**
 * Sign-in while Supabase Auth is down (T-M1-D06): runs only when AUTH_OUTAGE_E2E=1, i.e. from
 * infra/docker/smoke.sh after it stops the Auth gateway. The user sees the "problem on our side" message
 * with a reference id — never "wrong password" — and the error is reported to the error tracker (the
 * smoke test then looks for it in GlitchTip).
 */
test.describe('Auth outage', () => {
  test.skip(process.env.AUTH_OUTAGE_E2E !== '1', 'AUTH_OUTAGE_E2E not set');

  test('shows the internal-error message with a reference id', async ({ page }) => {
    await submitSignIn(page, 'outage.check@sovereign.example', 'Outage-Check-Password-1');
    await expect(page.getByTestId('sign-in-error')).toContainText('Reference:', afterSignIn);
    await expect(page.getByTestId('sign-in-error')).not.toContainText('incorrect');
  });
});
